/* eslint-disable no-console -- the tests silence expected error logs */
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { setStoreForTests } from '../admin/get-store';
import { PostgresStore } from '../admin/postgres-store';
import { careerNightly, startNightly } from '../../workflows/career-nightly';
import { gatherSource, markScoreFailed } from './steps';
import { SourceError } from './sources/http';
import type { RawPosting } from './types';
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
  assert.equal(aiCalls, 3, 'three replies before giving up');
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

test('a bad reply then a good one scores the posting', async () => {
  await setPrefs({ keywords: ['partner'] });
  const replies = ['sorry', SCORE];
  aiReply = () => replies.shift()!;
  await careerNightly();
  assert.deepEqual([(await lastRun()).scored, (await lastRun()).failed], [1, 0]);
});

test('a missing AI key defers scoring and marks nothing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await careerNightly();
  const run = await lastRun();
  assert.match(run.scoreSkipped!, /^ANTHROPIC_API_KEY is not set/);
  assert.deepEqual([run.scored, run.failed, run.deferred], [0, 0, 2]);
  assert.equal(aiCalls, 0);
  for (const r of await listPostings(sql, {})) assert.equal((await getPosting(sql, r.id))!.scoreError, null);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  await careerNightly();
  assert.equal((await lastRun()).scored, 2, 'scored once the key is set');
  assert.equal((await lastRun()).scoreSkipped, undefined);
});

test('no CV defers scoring too', async () => {
  await sql`delete from documents where path = 'config/cv.yml'`;
  await careerNightly();
  assert.match((await lastRun()).scoreSkipped!, /no CV/);
  assert.equal(aiCalls, 0);
});

test('a provider 500 leaves the posting pending', async () => {
  await setPrefs({ keywords: ['partner'] });
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('https://www.arbeitnow.com/')) return new Response(arbeitnow);
    if (url.startsWith('https://api.anthropic.com/'))
      return Response.json({ error: { message: 'overloaded' } }, { status: 500 });
    return new Response('down', { status: 503 });
  });
  await careerNightly();
  const run = await lastRun();
  assert.deepEqual([run.scored, run.failed, run.deferred], [0, 0, 1]);
  const [row] = await listPostings(sql, {});
  assert.equal((await getPosting(sql, row.id))!.scoreError, null, 'not marked: tomorrow tries again');
});

test('markScoreFailed leaves a scored posting alone', async () => {
  await setPrefs({ keywords: ['partner'] });
  await careerNightly();
  const [row] = await listPostings(sql, {});
  await markScoreFailed(row.id, 'late failure');
  const p = (await getPosting(sql, row.id))!;
  assert.equal(p.score, 75);
  assert.equal(p.scoreError, null);
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

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-21T12:00:00Z');
/** A fake Workflow API: the stored run has `status` and was created `age` ago; start() hands out wrun_new. */
function fakeRuns(status: string, age: number) {
  const calls = { cancelled: [] as string[], started: 0 };
  const runs = {
    get: (runId: string) => ({
      status: Promise.resolve(status),
      createdAt: Promise.resolve(new Date(NOW - age)),
      cancel: async () => void calls.cancelled.push(runId),
    }),
    start: async () => (calls.started++, { runId: 'wrun_new' }),
  };
  return { runs, calls };
}

test('a second start while running returns running', async () => {
  await writeCareer(sql, { runId: 'wrun_1' }, 'test');
  for (const status of ['running', 'pending']) {
    const { runs, calls } = fakeRuns(status, HOUR);
    assert.deepEqual(await startNightly(sql, runs, NOW), { running: 'wrun_1' });
    assert.deepEqual(calls, { cancelled: [], started: 0 });
  }
  assert.equal((await readCareer(sql)).runId, 'wrun_1');
  const { runs, calls } = fakeRuns('completed', HOUR);
  assert.deepEqual(await startNightly(sql, runs, NOW), { runId: 'wrun_new' });
  assert.deepEqual(calls, { cancelled: [], started: 1 });
  assert.equal((await readCareer(sql)).runId, 'wrun_new');
});

test('a run still pending or running after 6 hours is cancelled and a new one starts', async () => {
  for (const status of ['running', 'pending']) {
    await writeCareer(sql, { runId: 'wrun_stuck' }, 'test');
    const { runs, calls } = fakeRuns(status, 6 * HOUR + 1);
    assert.deepEqual(await startNightly(sql, runs, NOW), { runId: 'wrun_new' });
    assert.deepEqual(calls, { cancelled: ['wrun_stuck'], started: 1 });
    assert.equal((await readCareer(sql)).runId, 'wrun_new');
  }
  await writeCareer(sql, { runId: 'wrun_stuck' }, 'test');
  const { runs } = fakeRuns('running', 7 * HOUR);
  runs.get = (id) => ({
    ...fakeRuns('running', 7 * HOUR).runs.get(id),
    cancel: async () => Promise.reject(new Error('no')),
  });
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await startNightly(sql, runs, NOW), { runId: 'wrun_new' }, 'a failed cancel still restarts');
  } finally {
    console.error = original;
  }
});

const fake = (i: number, description = ''): RawPosting => ({
  source: 'fake',
  externalId: String(i),
  company: 'Fake Co',
  title: `Role ${i}`,
  url: `https://fake.test/${i}`,
  description,
  format: 'html',
});
/** Registers a throwaway source for one test. */
function fakeSource(
  search: () => Promise<RawPosting[]>,
  detail?: (p: RawPosting) => Promise<Pick<RawPosting, 'description' | 'format'>>,
) {
  SOURCES.fake = { id: 'fake', label: 'Fake', defaultOn: false, search, ...(detail ? { detail } : {}) };
}
afterEach(() => {
  delete SOURCES.fake;
});

test('a posting the guard cannot scan is skipped; the source carries on', async () => {
  fakeSource(async () => [fake(1, '<svg>'.repeat(100000)), fake(2, '<p>Fine</p>')]);
  assert.deepEqual(await gatherSource('fake'), { id: 'fake', found: 2, added: 1 });
});

test('invisible characters in title, company and location are stripped before storing', async () => {
  fakeSource(async () => [
    { ...fake(1, '<p>x</p>'), title: 'Dev\u202Eevil', company: 'A\u200Bcme', location: 'Be\u2028rn' },
  ]);
  await gatherSource('fake');
  const [r] = await sql<{
    title: string;
    company: string;
    location: string;
  }>`select title, company, location from career_postings`;
  assert.deepEqual({ ...r }, { title: 'Devevil', company: 'Acme', location: 'Bern' });
});

test('detail is fetched for at most 30 new postings; the rest wait for a later night', async () => {
  let calls = 0;
  const postings = Array.from({ length: 35 }, (_, i) => fake(i));
  fakeSource(
    async () => postings,
    async () => (calls++, { description: '<p>Detail</p>', format: 'html' }),
  );
  assert.deepEqual(await gatherSource('fake'), { id: 'fake', found: 35, added: 30 });
  assert.equal(calls, 30);
  calls = 0;
  assert.deepEqual(await gatherSource('fake'), { id: 'fake', found: 35, added: 5 });
  assert.equal(calls, 5, 'known postings are not fetched again');
});

test('a failed detail fetch is the source error; the other postings are still added', async () => {
  fakeSource(
    async () => [fake(1), fake(2)],
    async (p) => {
      if (p.externalId === '1') throw new SourceError('fake.test answered 500', 500);
      return { description: '<p>Detail</p>', format: 'html' };
    },
  );
  assert.deepEqual(await gatherSource('fake'), { id: 'fake', found: 2, added: 1, error: 'fake.test answered 500' });
});

test('an error that is not a SourceError is logged and reported as unexpected', async () => {
  fakeSource(async () => {
    throw new TypeError('Cannot read properties of undefined');
  });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    assert.deepEqual(await gatherSource('fake'), { id: 'fake', found: 0, added: 0, error: 'unexpected error' });
  } finally {
    console.error = original;
  }
  assert.equal(logged[0][0], '[career] fake');
});
