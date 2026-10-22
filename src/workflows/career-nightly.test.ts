import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { afterEach, beforeEach, mock } from 'node:test';
import type { CommandResult, SandboxHandle } from '../lib/admin/editor';
import { setStoreForTests } from '../lib/admin/get-store';
import { PostgresStore } from '../lib/admin/postgres-store';
import { setRendererForTests } from '../lib/cv-render';
import { setSqlForTests, type Sql } from '../lib/db';
import { migrate } from '../lib/db-migrate';
import { pgliteSql } from '../lib/pglite-sql';
import { setApplySandboxForTests } from '../lib/career/apply/sandbox';
import { AI_VALUES, fakeSandbox, FLAGS, ok } from '../lib/career/apply/test-kit';
import { getPosting, listPostings, readCareer, updatePosting, upsertPostings, writeCareer } from '../lib/career/db';
import { setBlobForTests } from '../lib/career/files';
import { SOURCES } from '../lib/career/sources';
import { setLookupForTests } from '../lib/career/sources/http';
import type { TailorPlan } from '../lib/career/tailor';
import { setWorkerSandboxForTests } from '../lib/career/worker';
import { careerNightly, errorText } from './career-nightly';

test('errorText keeps the provider message and drops the step wrapper', () => {
  assert.equal(
    errorText(
      new Error(
        'Step "step//./src/lib/career/steps//scorePosting" failed: Error: Anthropic answered 400: Your credit balance is too low',
      ),
    ),
    'Anthropic answered 400: Your credit balance is too low',
  );
  assert.equal(errorText('boom'), 'boom');
  assert.equal(errorText(new Error('x'.repeat(400))).length, 300);
  const wrapped = Object.assign(new Error('Step "scorePosting" failed after 1 attempt'), {
    cause: { message: 'Anthropic answered 529: Overloaded' },
  });
  assert.equal(errorText(wrapped), 'Anthropic answered 529: Overloaded', 'the original under the SDK’s wrapper');
});

const CV_YML = `cv:
  name: Ada Lovelace
  email: ada@example.com
  sections:
    experience:
      - company: Acme
        position: Engineer
        startDate: '2020-01'
        endDate: present
        highlights:
          - Led a team of 5
`;
const PLAN: TailorPlan = {
  sections: [{ title: 'experience', entries: [{ ref: 0, highlights: ['Led a five-person team'] }] }],
  requirements: [],
  letter: 'Dear team, I build engines.',
};
const SCORE = JSON.stringify({
  technical: 80,
  experience: 80,
  culture: 80,
  career: 80,
  location: 'pass',
  language: 'pass',
  eligibility: 'pass',
  strengths: [],
  gaps: [],
  notes: '',
});
const arbeitnow = fs.readFileSync('tests/fixtures/career/arbeitnow.json', 'utf8');
setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);

let sql: Sql;
let ai: Record<'score' | 'draft' | 'review' | 'values', number>;
let failScores: boolean;
const saved = { ...process.env };

const setPrefs = (extra: Record<string, unknown> = {}, sources: string[] = []) =>
  writeCareer(
    sql,
    {
      prefs: {
        keywords: ['partner', 'sales'],
        threshold: 70,
        sources: Object.fromEntries(Object.keys(SOURCES).map((id) => [id, { on: sources.includes(id) }])),
        ...extra,
      },
    },
    'test',
  );

let n = 0;
/** A scored posting, `found` with no draft: a candidate for tonight's drafts. */
async function match(company: string, score = 80): Promise<number> {
  const key = `m${++n}`;
  await upsertPostings(sql, [
    {
      source: 's',
      externalId: key,
      company,
      title: `Engineer ${n}`,
      url: `https://jobs.test/${key}`,
      applyUrl: `https://jobs.test/${key}/apply`,
      description: 'We build engines.',
      format: 'text',
      key,
      text: 'We build engines.',
      flags: FLAGS,
    },
  ]);
  const [{ id }] = await sql<{ id: number }>`select id from career_postings where key = ${key}`;
  await updatePosting(sql, Number(id), { score });
  return Number(id);
}
const lastRun = async () => (await readCareer(sql)).lastRun!;

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
  await sql`insert into documents (path, content) values
    ('config/cv.yml', ${CV_YML}), ('config/site.yml', ${"siteUrl: 'https://site.test'\n"})`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.RESEND_API_KEY;
  ai = { score: 0, draft: 0, review: 0, values: 0 };
  failScores = false;
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://www.arbeitnow.com/')) return new Response(arbeitnow);
    if (url.startsWith('https://blob.test/')) return new Response(`%PDF ${url}`);
    if (!url.startsWith('https://api.anthropic.com/')) return new Response('missing', { status: 404 });
    const system: string = JSON.parse(String(init?.body)).system;
    const kind = /^You tailor/.test(system)
      ? 'draft'
      : /^You review/.test(system)
        ? 'review'
        : /^You fill in/.test(system)
          ? 'values'
          : 'score';
    ai[kind]++;
    if (kind === 'score' && failScores) return Response.json({ error: { message: 'Overloaded' } }, { status: 529 });
    const text = { draft: JSON.stringify(PLAN), review: '{"ok":true,"issues":[]}', values: AI_VALUES, score: SCORE }[
      kind
    ];
    return Response.json({ content: [{ type: 'text', text }] });
  });
  setRendererForTests(async () => new Uint8Array([37, 80, 68, 70]));
  setBlobForTests({ put: async (pathname) => ({ url: `https://blob.test/${pathname}` }), del: async () => {} });
  await setPrefs();
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  setStoreForTests(null);
  setRendererForTests(null);
  setBlobForTests(null);
  setApplySandboxForTests(null);
  setWorkerSandboxForTests(null);
  process.env = { ...saved };
});

test('paused does nothing', async () => {
  await setPrefs({ nightly: { paused: true } }, ['arbeitnow']);
  const id = await match('Acme');
  await updatePosting(sql, id, { score: null });
  const run = await careerNightly();
  assert.equal(run.paused, true);
  assert.deepEqual([run.sources, run.scored, run.drafted ?? 0], [[], 0, 0]);
  assert.deepEqual(await lastRun(), run);
  assert.equal((await listPostings(sql, {})).length, 1, 'nothing gathered');
  assert.deepEqual(ai, { score: 0, draft: 0, review: 0, values: 0 });
});

test('stage 1 gathers without scoring', async () => {
  await setPrefs({ nightly: { stage: 1 } }, ['arbeitnow']);
  const run = await careerNightly();
  assert.deepEqual(run.sources, [{ id: 'arbeitnow', found: 2, added: 2 }]);
  assert.deepEqual([run.stage, run.scored, run.deferred], [1, 0, 0]);
  assert.deepEqual(ai, { score: 0, draft: 0, review: 0, values: 0 });
  for (const r of await listPostings(sql, {})) assert.equal(r.score, null);
});

test('stage 2 scores and drafts nothing', async () => {
  await setPrefs({ nightly: { stage: 2 } }, ['arbeitnow']);
  const run = await careerNightly();
  assert.equal(run.scored, 2);
  assert.equal(run.drafted, 0);
  assert.equal(ai.draft, 0);
});

test('stage 3 drafts at most maxDrafts matches', async () => {
  await setPrefs({ nightly: { maxDrafts: 2 } });
  const ids = [await match('A', 90), await match('B', 85), await match('C', 80)];
  const run = await careerNightly();
  assert.deepEqual([run.stage, run.drafted, run.limited, run.prefilled], [3, 2, 1, 0]);
  const states = await Promise.all(ids.map(async (id) => (await getPosting(sql, id))!));
  assert.deepEqual(
    states.map((p) => [p.status, p.draftState]),
    [
      ['drafted', 'done'],
      ['drafted', 'done'],
      ['found', 'none'],
    ],
  );
  assert.equal(states[0].application, null, 'stage 3 never pre-fills');
});

test('the company window holds back a third Uber posting', async () => {
  const old = await match('Uber', 99);
  await updatePosting(sql, old, { status: 'drafted' });
  const [a, b] = [await match('uber ', 90), await match('Uber', 85)];
  const run = await careerNightly();
  assert.deepEqual([run.drafted, run.limited], [1, 1]);
  assert.equal((await getPosting(sql, a))!.draftState, 'done');
  assert.equal((await getPosting(sql, b))!.draftState, 'none');
});

test('stage 4 pre-fills what drafted', async () => {
  await setPrefs({ nightly: { stage: 4 } });
  const id = await match('Acme');
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);
  const run = await careerNightly();
  assert.deepEqual([run.drafted, run.prefilled, run.handedOff], [1, 1, 0]);
  const p = (await getPosting(sql, id))!;
  assert.equal(p.status, 'ready');
  assert.equal(p.application?.state, 'ready');
  assert.deepEqual(
    sb.inputs.map((i) => i.mode),
    ['read', 'fill'],
    'never submits',
  );
});

test('stage 4 counts a hand-off and leaves the posting drafted', async () => {
  await setPrefs({ nightly: { stage: 4 } });
  const id = await match('Acme');
  setApplySandboxForTests(fakeSandbox((input) => ok(input, { blocker: 'captcha', ok: false })).api);
  const run = await careerNightly();
  assert.deepEqual([run.prefilled, run.handedOff], [0, 1]);
  const p = (await getPosting(sql, id))!;
  assert.deepEqual([p.status, p.application?.state], ['drafted', 'handoff']);
});

test('a quota error stops the night and is reported', async () => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test';
  await setPrefs({ worker: { kind: 'cli', agent: 'claude', auth: 'subscription' } });
  const [first, second] = [await match('A', 90), await match('B', 80)];
  const quota: CommandResult = {
    exitCode: 1,
    stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Claude AI usage limit reached|1792771200' }),
    stderr: '',
  };
  let cliRuns = 0;
  const vm = {
    status: 'running',
    run: async (script: string) =>
      script.includes('claude -p') ? (cliRuns++, quota) : { exitCode: 0, stdout: '', stderr: '' },
    readFile: async () => null,
    writeFiles: async () => {},
    setNetworkPolicy: async () => {},
    extendTimeout: async () => {},
    stop: async () => {},
  } as unknown as SandboxHandle;
  setWorkerSandboxForTests({ get: async () => vm, create: async () => vm });

  const run = await careerNightly();

  assert.match(run.stopped!, /^Your Claude subscription is out of quota until /);
  assert.equal(run.drafted, 0);
  assert.equal(cliRuns, 1, 'one call, then the night stops');
  assert.equal((await getPosting(sql, first))!.draftState, 'failed');
  assert.equal((await getPosting(sql, second))!.draftState, 'none', 'later candidates untouched');
  assert.equal(ai.draft + ai.review, 0, 'no API fallback');
});

test('a worker that is not set up stops drafting with the reason', async () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  await setPrefs({ worker: { kind: 'cli', agent: 'claude', auth: 'subscription' } });
  const id = await match('A');
  const run = await careerNightly();
  assert.match(run.stopped!, /^CLAUDE_CODE_OAUTH_TOKEN is not set/);
  assert.equal((await getPosting(sql, id))!.draftState, 'none');
});

test('all deferred keeps the reason', async () => {
  await setPrefs({ nightly: { stage: 2 } }, ['arbeitnow']);
  failScores = true;
  const run = await careerNightly();
  assert.deepEqual([run.scored, run.deferred], [0, 2]);
  assert.match(run.scoreError!, /Overloaded/);
});

test('the digest result is recorded; with no key it is skipped', async () => {
  await setPrefs({ digest: { on: true, to: 'me@x.test' } });
  await match('A');
  assert.equal((await careerNightly()).digest, 'skipped');
});
