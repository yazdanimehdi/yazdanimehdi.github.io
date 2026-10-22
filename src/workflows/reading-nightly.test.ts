import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { setStoreForTests } from '../lib/admin/get-store';
import { setPaperLookupForTests } from '../lib/admin/papers';
import { PostgresStore } from '../lib/admin/postgres-store';
import { SourceError, setLookupForTests } from '../lib/career/sources/http';
import { setSqlForTests, type Sql } from '../lib/db';
import { migrate } from '../lib/db-migrate';
import { pgliteSql } from '../lib/pglite-sql';
import { listDigests, readReading, setPaperState, writeReading } from '../lib/reading/db';
import { readingNightly, setReadingRunsForTests, startReading } from './reading-nightly';
import type { Runs } from './runs';

let sql: Sql;
let routes: Record<string, () => string>;
let ai: { score: number; area: number };
let failScoreCall: number;
let hosts: string[];
let log: string[];
let emails: number;

const fixture = (path: string) => fs.readFileSync(`tests/fixtures/${path}`, 'utf8');
/** The Hugging Face fixture as if each paper reached Daily Papers two days ago, inside the run's 7-day window. */
const hfDaily = () =>
  JSON.stringify(
    JSON.parse(fixture('reading/hf-daily.json')).map((e: { paper: object }) => ({
      ...e,
      paper: { ...e.paper, submittedOnDailyAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    })),
  );
const savedKey = process.env.ANTHROPIC_API_KEY;
const savedResend = process.env.RESEND_API_KEY;
const SLEEP = Symbol.for('WORKFLOW_SLEEP');
setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);

const setPrefs = (prefs: Record<string, unknown>) =>
  writeReading(sql, { prefs: { keywords: ['speech'], ...prefs } }, 'test');
const reply = (body: unknown) => Response.json({ content: [{ type: 'text', text: JSON.stringify(body) }] });
/** `n` bioRxiv papers, all about speech: one page of the details API. */
const rxiv = (n: number) =>
  JSON.stringify({
    messages: [{ status: 'ok', total: String(n) }],
    collection: Array.from({ length: n }, (_, i) => ({
      title: `Speech paper ${i}`,
      authors: 'Doe, J.; Roe, R.',
      doi: `10.1101/2026.10.20.${i}`,
      date: '2026-10-21',
      version: '1',
      category: 'neuroscience',
      abstract: 'About speech.',
      server: 'bioRxiv',
    })),
  });
const BIORXIV = { biorxiv: { on: true, categories: ['neuroscience'] } };
const ARXIV = { arxiv: { on: true, categories: ['cs.CL'] } };
const HF = { huggingface: { on: true } };
const today = async () => (await listDigests(sql, { days: 1 }))[0]?.items ?? [];

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
  await sql`insert into documents (path, content) values ('config/site.yml', ${"siteUrl: 'https://site.test'\n"})`;
  routes = {};
  setPaperLookupForTests({
    get: async (url) => {
      const hit = Object.keys(routes).find((part) => url.includes(part));
      if (!hit) throw new SourceError(`${new URL(url).host} answered 404`, 404);
      return routes[hit]();
    },
  });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  ai = { score: 0, area: 0 };
  failScoreCall = 0;
  hosts = [];
  log = [];
  emails = 0;
  (globalThis as Record<symbol, unknown>)[SLEEP] = async (d: string) => void log.push(`sleep ${d}`);
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    hosts.push(new URL(url).host);
    if (url.startsWith('https://arxiv.org/html/')) {
      log.push(`html ${url.slice('https://arxiv.org/html/'.length)}`);
      return new Response('<html><body><div id="S1.p1" class="ltx_para"><p>Full text</p></div></body></html>');
    }
    if (url === 'https://api.resend.com/emails') return (emails++, Response.json({ id: 'email_1' }));
    if (!url.startsWith('https://api.anthropic.com/')) return new Response('missing', { status: 404 });
    const body = JSON.parse(String(init!.body));
    const ids = [...String(body.messages[0].content).matchAll(/<paper id="(\d+)">\n([^\n]*)/g)].map((m) => ({
      id: Number(m[1]),
      title: m[2],
    }));
    if (/^You decide which papers/.test(body.system)) {
      ai.area++;
      return reply({ keep: ids.map((p) => p.id) });
    }
    ai.score++;
    if (ai.score === failScoreCall)
      return Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low.' } },
        { status: 400 },
      );
    return reply({
      scores: ids.map((p) => ({ id: p.id, score: /speech/i.test(p.title) ? 90 : 10, reason: 'Fits.', related: null })),
    });
  });
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  setStoreForTests(null);
  setPaperLookupForTests(null);
  setReadingRunsForTests(null);
  delete (globalThis as Record<symbol, unknown>)[SLEEP];
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedResend === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedResend;
});

test('paused does nothing else', async () => {
  await setPrefs({ paused: true, sources: { ...ARXIV, ...HF } });
  routes['rss.arxiv.org'] = () => fixture('reading/arxiv-rss.xml');
  const run = await readingNightly();
  assert.equal(run.paused, true);
  assert.deepEqual([run.sources, run.aiCalls, run.talked, run.inField], [[], 0, 0, 0]);
  assert.deepEqual((await readReading(sql)).lastRun, run);
  assert.deepEqual(hosts, []);
  assert.deepEqual(await listDigests(sql, { days: 1 }), []);
  assert.equal(Number((await sql<{ n: number }>`select count(*) as n from reading_papers`)[0].n), 0);
});

test('nothing new costs no AI call', async () => {
  await setPrefs({ area: 'speech', sources: { ...ARXIV, ...BIORXIV, ...HF } });
  routes['rss.arxiv.org'] = () => '<rss version="2.0"><channel></channel></rss>';
  routes['api.biorxiv.org'] = () => rxiv(0);
  routes['huggingface.co'] = () => '[]';
  const run = await readingNightly();
  assert.equal(run.aiCalls, 0);
  assert.equal(run.stopped, undefined);
  assert.deepEqual(ai, { score: 0, area: 0 });
  assert.deepEqual([run.talked, run.inField, run.unranked], [0, 0, 0]);
  assert.deepEqual(await today(), []);
  assert.deepEqual(
    run.sources.map((s) => [s.id, s.found, s.error]),
    [
      ['arxiv', 0, undefined],
      ['biorxiv', 0, undefined],
      ['huggingface', 0, undefined],
    ],
  );
});

test('a failing source is reported and the rest of the digest still appears', async () => {
  await setPrefs({ sources: { ...ARXIV, ...BIORXIV } });
  routes['rss.arxiv.org'] = () => {
    throw new SourceError('rss.arxiv.org answered 503', 503);
  };
  routes['api.biorxiv.org'] = () => rxiv(3);
  const run = await readingNightly();
  assert.deepEqual(run.sources, [
    { id: 'arxiv', found: 0, added: 0, error: 'rss.arxiv.org answered 503' },
    { id: 'biorxiv', found: 3, added: 3 },
  ]);
  assert.equal(run.inField, 3);
  assert.equal(run.stopped, undefined);
  assert.deepEqual(
    (await today()).map((i) => i.section),
    ['field', 'field', 'field'],
  );
});

test('a provider error stops ranking and lists the rest as not ranked tonight', async () => {
  await setPrefs({ area: 'speech', sources: { ...BIORXIV, ...HF } });
  routes['api.biorxiv.org'] = () => rxiv(15);
  routes['huggingface.co'] = () => hfDaily();
  failScoreCall = 2;
  const run = await readingNightly();
  assert.match(run.stopped!, /credit balance is too low/);
  assert.deepEqual([run.ranked, run.unranked, run.aiCalls, run.inField], [10, 5, 1, 8]);
  assert.deepEqual(ai, { score: 2, area: 0 }, 'ranking stops; no area check after a provider error');
  assert.equal(run.talked, 0, 'without the area check, no talked-about list');
  assert.equal(run.talkedSkipped, 'ranking stopped');
  const items = await today();
  assert.equal(items.filter((i) => i.section === 'unranked').length, 5);
  assert.ok(items.filter((i) => i.section === 'unranked').every((i) => i.line === 'Not ranked tonight'));
  assert.deepEqual(
    hosts.filter((h) => h !== 'arxiv.org'),
    ['api.anthropic.com', 'api.anthropic.com'],
    'no other provider is tried',
  );
});

test('the AI cap leaves the rest unranked without stopping', async () => {
  await setPrefs({ maxAiCalls: 1, area: 'speech', sources: { ...BIORXIV, ...HF } });
  routes['api.biorxiv.org'] = () => rxiv(15);
  routes['huggingface.co'] = () => hfDaily();
  const run = await readingNightly();
  assert.equal(run.stopped, undefined);
  assert.deepEqual([run.aiCalls, run.ranked, run.unranked], [1, 10, 5]);
  assert.deepEqual(ai, { score: 1, area: 0 });
  assert.deepEqual([run.talked, run.talkedSkipped], [0, 'AI cap spent'], 'the cap is why talked is empty');
});

test('a second run the same day replaces today’s digest without rescoring', async () => {
  await setPrefs({ sources: { ...BIORXIV, ...HF } });
  routes['api.biorxiv.org'] = () => rxiv(3);
  routes['huggingface.co'] = () => hfDaily();
  const first = await readingNightly();
  const before = await today();
  assert.equal(ai.score, 1);
  const saved = [before[0], before.at(-1)!];
  assert.deepEqual(
    saved.map((i) => i.section),
    ['talked', 'field'],
  );
  for (const i of saved) await setPaperState(sql, i.paper.id, 'saved');
  const second = await readingNightly();
  assert.equal(ai.score, 1, 'already-scored papers cost no new call');
  assert.equal(second.aiCalls, 0);
  const after = await today();
  const shape = (items: typeof before) => items.map((i) => [i.section, i.paper.id, i.line]);
  assert.deepEqual(shape(after), shape(before), 'today’s papers are kept, saved ones too, not dropped as shown before');
  assert.equal(new Set(after.map((i) => i.paper.id)).size, after.length, 'no paper twice');
  assert.deepEqual([second.talked, second.inField], [first.talked, first.inField]);
});

test('a second run the same day does not email the digest again', async () => {
  process.env.RESEND_API_KEY = 're_test';
  await setPrefs({ sources: BIORXIV, email: { on: true, to: 'me@site.test' } });
  routes['api.biorxiv.org'] = () => rxiv(3);
  assert.equal((await readingNightly()).email, 'sent');
  assert.equal(emails, 1);
  assert.equal((await readingNightly()).email, 'sent', 'today’s email still counts as sent');
  assert.equal((await readingNightly()).email, 'sent');
  assert.equal(emails, 1, 'sent once');
});

test('talked papers carry their numbers', async () => {
  await setPrefs({ area: 'machine learning', sources: HF });
  routes['huggingface.co'] = () => hfDaily();
  const run = await readingNightly();
  assert.equal(run.talked, 3);
  assert.deepEqual([ai.area, run.aiCalls], [1, 1], 'one area check, counted');
  const [top] = await today();
  assert.equal(top.section, 'talked');
  assert.equal(top.paper.url, 'https://arxiv.org/abs/2610.14224');
  assert.match(top.line, /^116 upvotes and 2 comments on Hugging Face in \d+ days/);
});

test('prefetch fetches arXiv HTML for digest papers only', async () => {
  await setPrefs({ sources: { ...ARXIV, ...HF } });
  routes['rss.arxiv.org'] = () => fixture('reading/arxiv-rss.xml');
  routes['huggingface.co'] = () => hfDaily();
  // A sleep returns at once, so it moves arXiv's last slot back by its length, as if that time had passed.
  (globalThis as Record<symbol, unknown>)[SLEEP] = async (ms: number) => {
    log.push(ms > 14_000 && ms <= 15_000 ? 'sleep ~15s' : `sleep ${ms}`);
    await sql`update reading_settings set arxiv_at = arxiv_at - ${ms} * interval '1 millisecond'`;
  };
  const run = await readingNightly();
  assert.equal(run.inField, 1, 'only the speech paper scores high enough');
  assert.deepEqual(log, [
    'html 2610.14224',
    'sleep ~15s',
    'html 2610.23374',
    'sleep ~15s',
    'html 2508.02739',
    'sleep ~15s',
    'html 2610.28673',
  ]);
  assert.deepEqual(run.texts, { fetched: 4, failed: 0 });
});

test('startReading does not start a second run while one is running', async () => {
  const calls = { started: 0, cancelled: 0 };
  const fake = (status: string): Runs => ({
    get: () => ({
      status: Promise.resolve(status),
      createdAt: Promise.resolve(new Date()),
      cancel: async () => void calls.cancelled++,
    }),
    start: async () => (calls.started++, { runId: 'wrun_new' }),
  });
  await writeReading(sql, { runId: 'wrun_1' }, 'test');
  assert.deepEqual(await startReading(sql, fake('running')), { running: 'wrun_1' });
  assert.deepEqual(calls, { started: 0, cancelled: 0 });
  setReadingRunsForTests(fake('completed'));
  assert.deepEqual(await startReading(sql), { runId: 'wrun_new' });
  assert.equal((await readReading(sql)).runId, 'wrun_new');
  assert.deepEqual(calls, { started: 1, cancelled: 0 });
});
