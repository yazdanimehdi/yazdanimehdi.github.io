import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { setStoreForTests } from '../admin/get-store';
import { PostgresStore } from '../admin/postgres-store';
import { careerNightly, startNightly } from '../../workflows/career-nightly';
import { getPosting, listPostings, readCareer, updatePosting, writeCareer } from './db';
import { setLookupForTests } from './sources/http';
import { SOURCES } from './sources';

let sql: Sql;
let aiCalls: number;
let aiReply: () => string;
const SCORE = JSON.stringify({
  technical: 80,
  experience: 60,
  culture: 40,
  career: 100,
  location: 'pass',
  language: 'pass',
  eligibility: 'pass',
  strengths: ['python'],
  gaps: [],
  notes: '',
});
const arbeitnow = fs.readFileSync('tests/fixtures/career/arbeitnow.json', 'utf8');

/** Only remotive and arbeitnow are on; the keywords match both arbeitnow fixture postings. */
const setPrefs = (extra: Record<string, unknown> = {}) =>
  writeCareer(
    sql,
    {
      prefs: {
        keywords: ['partner', 'sales'],
        sources: Object.fromEntries(
          Object.keys(SOURCES).map((id) => [id, { on: id === 'remotive' || id === 'arbeitnow' }]),
        ),
        ...extra,
      },
    },
    'test',
  );

const savedKey = process.env.ANTHROPIC_API_KEY;
setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
  await sql`insert into documents (path, content) values
    ('config/cv.yml', ${"cv:\n  name: 'Jane'\n  sections:\n    skills:\n      - label: Python\n        details: daily\n"}),
    ('config/site.yml', ${"siteUrl: 'https://site.test'\n"})`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  aiCalls = 0;
  aiReply = () => SCORE;
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('https://remotive.com/')) return new Response('down', { status: 503 });
    if (url.startsWith('https://www.arbeitnow.com/')) return new Response(arbeitnow);
    if (url.startsWith('https://api.anthropic.com/')) {
      aiCalls++;
      return Response.json({ content: [{ type: 'text', text: aiReply() }] });
    }
    return new Response('missing', { status: 404 });
  });
  await setPrefs();
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  setStoreForTests(null);
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

const lastRun = async () => (await readCareer(sql)).lastRun!;
const source = (run: Awaited<ReturnType<typeof lastRun>>, id: string) => run.sources.find((s) => s.id === id);

test('one source failing still scores the others', async () => {
  await careerNightly();
  const run = await lastRun();
  assert.deepEqual(
    run.sources.map((s) => s.id),
    ['remotive', 'arbeitnow'],
  );
  assert.equal(source(run, 'remotive')!.error, 'remotive.com answered 503');
  assert.deepEqual(source(run, 'arbeitnow'), { id: 'arbeitnow', found: 2, added: 2 });
  assert.equal(run.scored, 2);
  assert.equal(run.failed, 0);
  const rows = await listPostings(sql, {});
  assert.deepEqual(
    rows.map((r) => r.score),
    [75, 75],
  );
});

test('running the night twice adds nothing and keeps statuses', async () => {
  await careerNightly();
  const [first] = await listPostings(sql, {});
  await updatePosting(sql, first.id, { status: 'skipped' });
  aiCalls = 0;
  await careerNightly();
  const run = await lastRun();
  assert.deepEqual(source(run, 'arbeitnow'), { id: 'arbeitnow', found: 2, added: 0 });
  assert.equal(run.scored, 0);
  assert.equal(aiCalls, 0);
  assert.equal((await getPosting(sql, first.id))!.status, 'skipped');
});

test('a broken AI reply leaves the posting unscored with score_error, not 0', async () => {
  await setPrefs({ keywords: ['partner'] });
  aiReply = () => 'sorry';
  await careerNightly();
  const run = await lastRun();
  assert.equal(run.failed, 1);
  assert.equal(run.scored, 0);
  const [row] = await listPostings(sql, {});
  const p = (await getPosting(sql, row.id))!;
  assert.equal(p.score, null);
  assert.match(p.scoreError!, /did not return the JSON score/);
  assert.ok(p.scoredAt, 'the failure is stamped');
  aiReply = () => SCORE;
  await careerNightly();
  assert.equal((await lastRun()).scored, 0, 'a failed posting is not retried every night');
});

test('the cap defers the rest', async () => {
  await setPrefs({ maxScoresPerRun: 1 });
  await careerNightly();
  const run = await lastRun();
  assert.equal(run.scored, 1);
  assert.equal(run.deferred, 1);
  assert.equal(aiCalls, 1);
});

test('gated postings are never sent to the AI', async () => {
  await setPrefs({ avoidCompanies: ['allaboutHRLaw GmbH'] });
  await careerNightly();
  assert.equal(aiCalls, 1);
  const rows = await listPostings(sql, {});
  const gated = rows.find((r) => r.company === 'allaboutHRLaw GmbH')!;
  assert.equal(gated.gate, 'company on your avoid list');
  assert.equal(gated.score, null);
  assert.equal((await lastRun()).scored, 1);
});

test('a source missing its key is skipped, not failed; a source off in prefs is not listed', async () => {
  const saved = process.env.SERPAPI_KEY;
  delete process.env.SERPAPI_KEY;
  try {
    await setPrefs({ sources: { 'google-jobs': { on: true }, remotive: { on: false }, arbeitnow: { on: false } } });
    await careerNightly();
    const run = await lastRun();
    assert.deepEqual(source(run, 'google-jobs'), { id: 'google-jobs', found: 0, added: 0, skipped: 'no SERPAPI_KEY' });
    assert.equal(source(run, 'remotive'), undefined);
    assert.ok(source(run, 'remoteok'), 'a default-on source prefs do not mention runs');
  } finally {
    if (saved !== undefined) process.env.SERPAPI_KEY = saved;
  }
});

test('a second start while running returns running', async () => {
  await writeCareer(sql, { runId: 'wrun_1' }, 'test');
  assert.deepEqual(await startNightly(sql, async () => 'running'), { running: 'wrun_1' });
  assert.deepEqual(await startNightly(sql, async () => 'pending'), { running: 'wrun_1' });
  assert.equal((await readCareer(sql)).runId, 'wrun_1');
});
