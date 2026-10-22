import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { setStoreForTests } from '../admin/get-store';
import { PostgresStore } from '../admin/postgres-store';
import { setPaperLookupForTests } from '../admin/papers';
import { SourceError, setLookupForTests } from '../career/sources/http';
import {
  getPapers,
  listDigests,
  mergeSignals,
  saveDigest,
  setPaperState,
  setScore,
  upsertPapers,
  writeReading,
} from './db';
import type { NewPaper, Signals } from './types';
import { areaFilter, collectNew, saveDigestStep, scoreBatch, tractionShortlist } from './steps';

let sql: Sql;
let routes: Record<string, () => string>;
let aiCalls: number;
let aiPrompts: string[];
let aiReply: () => Response;

const fixture = (path: string) => fs.readFileSync(`tests/fixtures/${path}`, 'utf8');
const savedKey = process.env.ANTHROPIC_API_KEY;
setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);

const setPrefs = (prefs: Record<string, unknown>) => writeReading(sql, { prefs }, 'test');
const reply = (body: unknown) => Response.json({ content: [{ type: 'text', text: JSON.stringify(body) }] });

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
  await sql`insert into documents (path, content) values
    ('config/site.yml', ${"siteUrl: 'https://site.test'\n"}),
    ('src/content/publications/mine.md', ${"---\ntitle: 'Frozen Encoders for Dialect Speech'\n---\n"})`;
  routes = {};
  setPaperLookupForTests({
    get: async (url) => {
      const hit = Object.keys(routes).find((part) => url.includes(part));
      if (!hit) throw new SourceError(`${new URL(url).host} answered 404`, 404);
      return routes[hit]();
    },
  });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  aiCalls = 0;
  aiPrompts = [];
  aiReply = () => reply({});
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.anthropic.com/')) {
      aiCalls++;
      const body = JSON.parse(String(init!.body));
      aiPrompts.push(`${body.system}\n${body.messages[0].content}`);
      return aiReply();
    }
    return new Response('missing', { status: 404 });
  });
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  setStoreForTests(null);
  setPaperLookupForTests(null);
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

const paper = (key: string, extra: Partial<NewPaper> = {}): NewPaper => ({
  key,
  source: 'arxiv',
  title: `Paper ${key}`,
  authors: ['A. Author'],
  url: `https://x.test/${key}`,
  categories: [],
  ...extra,
});
const add = async (...papers: NewPaper[]) => (await upsertPapers(sql, papers)).map((r) => r.id);

test('collectNew stores candidates and leaves out papers shown on an earlier day', async () => {
  await setPrefs({ keywords: ['speech'], sources: { arxiv: { on: true, categories: ['cs.CL'] } } });
  routes['rss.arxiv.org'] = () => fixture('reading/arxiv-rss.xml');
  const first = await collectNew('arxiv', '2026-10-22');
  assert.equal(first.found, 3);
  assert.equal(first.added, 3);
  assert.equal(first.error, undefined);
  const [speech, other, third] = first.candidates;
  assert.ok(speech.overlap > 0, 'the speech paper matches the keyword');
  assert.equal(other.overlap, 0);
  assert.equal((await getPapers(sql, [speech.id]))[0].arxiv, '2610.28673');

  await saveDigest(sql, '2026-10-21', [{ paperId: speech.id, section: 'field', rank: 1, line: 'x' }]);
  await saveDigest(sql, '2026-10-22', [{ paperId: other.id, section: 'field', rank: 1, line: 'today' }]);
  await setPaperState(sql, third.id, 'dismissed');
  const again = await collectNew('arxiv', '2026-10-22');
  assert.equal(again.found, 3);
  assert.equal(again.added, 0);
  assert.deepEqual(
    again.candidates.map((c) => c.id),
    [other.id],
    "today's own digest paper stays; an earlier day's and a dismissed one go",
  );
});

test('collectNew reports a source error without throwing', async () => {
  await setPrefs({ sources: { arxiv: { on: true, categories: ['cs.CL'] } } });
  routes['rss.arxiv.org'] = () => {
    throw new SourceError('rss.arxiv.org answered 503', 503);
  };
  assert.deepEqual(await collectNew('arxiv', '2026-10-22'), {
    id: 'arxiv',
    found: 0,
    added: 0,
    error: 'rss.arxiv.org answered 503',
    candidates: [],
  });
  const error = mock.method(console, 'error', () => {});
  routes['rss.arxiv.org'] = () => {
    throw new TypeError('boom');
  };
  assert.equal((await collectNew('arxiv', '2026-10-22')).error, 'unexpected error');
  assert.equal(error.mock.callCount(), 1);
});

test('scoreBatch scores only unscored papers and stores the reason', async () => {
  await setPrefs({ field: 'Arabic speech recognition', keywords: ['speech'] });
  const [a, b, done] = await add(paper('arxiv:1'), paper('arxiv:2'), paper('arxiv:3'));
  await setScore(sql, done, { score: 40, reason: 'old', related: null });
  aiReply = () =>
    reply({
      scores: [
        {
          id: a,
          score: 88,
          reason: 'Adapts a frozen encoder to dialects.',
          related: 'frozen encoders for dialect speech',
        },
        { id: b, score: 20, reason: 'A different field.', related: 'Not my paper' },
        { id: done, score: 99, reason: 'ignored', related: null },
      ],
    });
  assert.equal(await scoreBatch([a, b, done]), 1);
  assert.equal(aiCalls, 1);
  assert.ok(!aiPrompts[0].includes('Paper arxiv:3'), 'a scored paper is not sent again');
  assert.ok(aiPrompts[0].includes('Field: Arabic speech recognition'));
  assert.ok(aiPrompts[0].includes('- Frozen Encoders for Dialect Speech'), 'the owner papers are in the prompt');
  const [pa, pb, pdone] = await getPapers(sql, [a, b, done]);
  assert.deepEqual(
    [pa.score, pa.reason, pa.related],
    [88, 'Adapts a frozen encoder to dialects.', 'Frozen Encoders for Dialect Speech'],
  );
  assert.deepEqual([pb.score, pb.related], [20, null]);
  assert.deepEqual([pdone.score, pdone.reason], [40, 'old']);

  assert.equal(await scoreBatch([a, b, done]), 0, 'nothing left to score costs no call');
  assert.equal(aiCalls, 1);
});

test('scoreBatch leaves papers unscored after two bad replies, and scores without a readable profile', async () => {
  await sql`insert into documents (path, content) values ('config/research.yml', ${'areas: [unclosed\n'})`;
  const error = mock.method(console, 'error', () => {});
  const [a] = await add(paper('arxiv:1'));
  aiReply = () => reply({ nothing: true });
  assert.equal(await scoreBatch([a]), 2);
  assert.equal((await getPapers(sql, [a]))[0].score, null);
  assert.ok(!aiPrompts[0].includes("The owner's papers"), 'a broken research.yml degrades to an empty profile');
  assert.ok(error.mock.callCount() >= 1, 'the broken profile is logged');
});

test('scoreBatch throws on a provider error', async () => {
  const [a] = await add(paper('arxiv:1'));
  aiReply = () =>
    Response.json(
      {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API.' },
      },
      { status: 400 },
    );
  await assert.rejects(scoreBatch([a]), /credit balance is too low/);
  assert.equal(aiCalls, 1);
  assert.equal((await getPapers(sql, [a]))[0].score, null);
});

test('tractionShortlist lets a talked paper back only when its number doubled', async () => {
  const hf = (upvotes: number): Signals => ({ huggingface: { upvotes, comments: 0, since: '2026-10-20' } });
  const [grew, doubled, inField, fresh, noNumber, dismissed] = await add(
    paper('arxiv:1', { signals: hf(10) }),
    paper('arxiv:2', { signals: hf(10) }),
    paper('arxiv:3', { signals: hf(40) }),
    paper('arxiv:4', { signals: { ...hf(5), bluesky: { posts: 100, capped: true } } }),
    paper('arxiv:5', { signals: { bluesky: { posts: 50, capped: false } } }),
    paper('arxiv:6', { signals: hf(30) }),
  );
  await saveDigest(sql, '2026-10-20', [
    { paperId: grew, section: 'talked', rank: 1, line: 'x', signals: hf(10) },
    { paperId: doubled, section: 'talked', rank: 2, line: 'x', signals: hf(10) },
    { paperId: inField, section: 'field', rank: 1, line: 'x' },
  ]);
  await mergeSignals(sql, grew, hf(15));
  await mergeSignals(sql, doubled, hf(20));
  await setPaperState(sql, dismissed, 'dismissed');
  const all = [grew, doubled, inField, fresh, noNumber, dismissed];
  assert.deepEqual(
    await tractionShortlist(all, '2026-10-22', 5),
    [doubled, fresh],
    'by upvotes, not by the Bluesky posts',
  );
  const many = await add(...Array.from({ length: 50 }, (_, i) => paper(`arxiv:m${i}`, { signals: hf(i + 1) })));
  assert.equal((await tractionShortlist(many, '2026-10-22', 1)).length, 3, 'first 3n');
  assert.equal((await tractionShortlist(many, '2026-10-22', 20)).length, 40, 'at most 40');
});

test('areaFilter never adds a paper', async () => {
  await setPrefs({ area: 'speech processing' });
  const [a, b] = await add(paper('arxiv:1'), paper('arxiv:2'));
  aiReply = () => reply({ keep: [b, 9999, a] });
  assert.deepEqual(await areaFilter([a]), [a]);
  assert.equal(aiCalls, 1);
  assert.ok(aiPrompts[0].includes('Area: speech processing'));
});

test('saveDigestStep fills talked, field and not-ranked sections with their lines', async () => {
  await setPrefs({ talked: 2, inField: 2, minScore: 60 });
  const [t1, t2, t3, f1, f2, f3, u1, u2, u3] = await add(
    paper('arxiv:t1', { arxiv: 't1', signals: { alphaxiv: { visits: 1200, votes: 3 } } }),
    paper('arxiv:t2', {
      signals: { openalex: { citations: 3, since: '2026-10-01' }, bluesky: { posts: 4, capped: false } },
    }),
    paper('arxiv:t3', { signals: { alphaxiv: { visits: 100, votes: 0 } } }),
    paper('arxiv:f1', { arxiv: 'f1' }),
    paper('arxiv:f2'),
    paper('arxiv:f3'),
    paper('arxiv:u1'),
    paper('arxiv:u2'),
    paper('arxiv:u3'),
  );
  await setScore(sql, f1, { score: 70, reason: 'Same task.', related: null });
  await setScore(sql, f2, { score: 90, reason: 'Builds on your encoder.', related: 'Frozen Encoders' });
  await setScore(sql, f3, { score: 80, reason: 'Third.', related: null });
  const out = await saveDigestStep({
    day: '2026-10-22',
    talked: [t3, t1, t2],
    pool: [t1, f1, u1, f2, f3, u2, u3],
    stopped: true,
  });
  assert.deepEqual(out, { talked: 2, inField: 2, unranked: 3, prefetch: [t1] });
  const [today] = await listDigests(sql, { days: 1 });
  assert.equal(today.day, '2026-10-22');
  assert.deepEqual(
    today.items.map((i) => [i.section, i.rank, i.paper.id, i.line]),
    [
      ['talked', 1, t2, 'cited 3 times since 1 Oct 2026 (OpenAlex) · 4 Bluesky posts'],
      ['talked', 2, t1, '1,200 visits on alphaXiv this week'],
      ['field', 1, f2, 'Builds on your encoder. · Close to your “Frozen Encoders”'],
      ['field', 2, f3, 'Third.'],
      ['unranked', 1, u1, 'Not ranked tonight'],
      ['unranked', 2, u2, 'Not ranked tonight'],
    ],
  );
  const [shown] = await sql<{ signals: Signals }>`select signals from reading_digest where paper_id = ${t1}`;
  assert.deepEqual(shown.signals, { alphaxiv: { visits: 1200, votes: 3 } }, 'talked items keep their numbers');
});

test('saveDigestStep leaves the field section short rather than below minScore', async () => {
  const [a, b] = await add(paper('arxiv:a'), paper('arxiv:b'));
  await setScore(sql, a, { score: 59, reason: 'Close.', related: null });
  await setScore(sql, b, { score: 60, reason: 'Enough.', related: null });
  const out = await saveDigestStep({ day: '2026-10-22', talked: [], pool: [a, b], stopped: false });
  assert.deepEqual(out, { talked: 0, inField: 1, unranked: 0, prefetch: [] });
  const [today] = await listDigests(sql, { days: 1 });
  assert.deepEqual(
    today.items.map((i) => [i.section, i.paper.id]),
    [['field', b]],
  );
});
