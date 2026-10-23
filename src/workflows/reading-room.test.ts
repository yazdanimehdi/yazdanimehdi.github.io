import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { setStoreForTests } from '../lib/admin/get-store';
import { PostgresStore } from '../lib/admin/postgres-store';
import { setLookupForTests } from '../lib/career/sources/http';
import { setSqlForTests, type Sql } from '../lib/db';
import { migrate } from '../lib/db-migrate';
import { pgliteSql } from '../lib/pglite-sql';
import { saveText, upsertPapers, writeReading } from '../lib/reading/db';
import { createNotebook, getOutputs, getPassages, readText, updateNotebook, useAiCall } from '../lib/reading/room-db';
import type { NewPaper, OutputKind, Target } from '../lib/reading/types';
import { readingRoom, startRoomRun, type RoomRuns } from './reading-room';

let sql: Sql;
let arxivDown: boolean;
let requests: { system: string; prompt: string; content: { type: string }[] }[];
let answer: (ids: string[]) => unknown;
let providerError: string | null;
const SLEEP = Symbol.for('WORKFLOW_SLEEP');
const savedKey = process.env.ANTHROPIC_API_KEY;
setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);

const HTML = fs.readFileSync('tests/fixtures/reading/arxiv-html.html', 'utf8');
const SECTIONS = ['Summary', 'What they did', 'What they found', 'Why it matters', 'How it relates to your work'];
/** Five sections, each claim citing the first passage of every paper in the prompt. */
const fiveSections = (ids: string[]) => {
  const firsts = [...new Map(ids.map((id) => [id.split(':')[0], id])).values()];
  return { sections: SECTIONS.map((heading) => ({ heading, claims: [{ text: `${heading}.`, cites: firsts }] })) };
};

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
  await sql`insert into documents (path, content) values ('config/site.yml', ${"siteUrl: 'https://site.test'\n"})`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  arxivDown = false;
  requests = [];
  answer = fiveSections;
  providerError = null;
  (globalThis as Record<symbol, unknown>)[SLEEP] = async () => {};
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://arxiv.org/html/'))
      return arxivDown ? new Response('busy', { status: 503 }) : new Response(HTML);
    if (!url.startsWith('https://api.anthropic.com/')) return new Response('missing', { status: 404 });
    const body = JSON.parse(String(init!.body));
    const content = body.messages[0].content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    const prompt = blocks.map((b: { text?: string }) => b.text ?? '').join('\n');
    requests.push({ system: body.system, prompt, content: blocks });
    if (providerError)
      return Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: providerError } },
        { status: 400 },
      );
    assert.match(body.system, /^You (summarize|write a briefing)/);
    const ids = [...prompt.matchAll(/^\[(\d+:[^\]]+)\]/gm)].map((m) => m[1]);
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(answer(ids)) }] });
  });
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  setStoreForTests(null);
  delete (globalThis as Record<symbol, unknown>)[SLEEP];
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
  abstract: `The abstract of ${key}.`,
  arxiv: key,
  ...extra,
});
const add = async (...papers: NewPaper[]) => (await upsertPapers(sql, papers)).map((r) => r.id);
/** Claims an output row as startRoomRun does, and returns its id. */
const outputRow = async (target: Target, kind: OutputKind = 'summary') => {
  const runs: RoomRuns = { get: () => assert.fail('no run yet'), start: async () => ({ runId: 'run' }) };
  assert.ok(await startRoomRun(sql, target, kind, runs));
  return (await getOutputs(sql, target))[kind]!;
};
const run = async (papers: number[], target: Target, kind: OutputKind = 'summary') => {
  await readingRoom({ papers, outputId: (await outputRow(target, kind)).id });
  return (await getOutputs(sql, target))[kind]!;
};
const stored = async (ids: number[]) => new Set((await getPassages(sql, ids)).map((p) => `${p.paperId}:${p.pid}`));

test('a summary fetches the text and cites its passages', async () => {
  const [id] = await add(paper('2310.06825'));
  const out = await run([id], { paper: id });
  assert.equal(out.status, 'ready');
  assert.equal(out.error, null);
  assert.deepEqual(
    out.body!.sections.map((s) => s.heading),
    SECTIONS,
  );
  const pids = await stored([id]);
  assert.ok(pids.size > 1, 'the text is stored as passages');
  const cites = out.body!.sections.flatMap((s) => s.claims.flatMap((c) => c.cites));
  assert.ok(cites.length);
  assert.ok(cites.every((c) => pids.has(`${c.paper}:${c.pid}`)));
  assert.equal(requests.length, 1);
  assert.match(requests[0].prompt, /<paper id="\d+" title="Paper 2310.06825">/);
});

test('a reply citing an unknown passage keeps the claim as background', async () => {
  const [id] = await add(paper('2310.06825'));
  answer = () => ({
    sections: [{ heading: 'Summary', claims: [{ text: 'A claim.', cites: [`${id}:S99.p9`, '999:S1.p1'] }] }],
  });
  const out = await run([id], { paper: id });
  assert.equal(out.status, 'ready');
  assert.deepEqual(out.body!.sections, [{ heading: 'Summary', claims: [{ text: 'A claim.', cites: [] }] }]);
});

test('a provider error fails the summary with its message', async () => {
  const [id] = await add(paper('2310.06825'));
  providerError = 'Your credit balance is too low.';
  const out = await run([id], { paper: id });
  assert.equal(out.status, 'failed');
  assert.match(out.error!, /credit balance is too low/);
  assert.equal(out.body, null);
});

test('a text fetch that failed with 503 fails the summary and is retried next time', async () => {
  const [id] = await add(paper('2310.06825'));
  arxivDown = true;
  const out = await run([id], { paper: id });
  assert.equal(out.status, 'failed');
  assert.equal(out.error, "Couldn't fetch the text of “Paper 2310.06825”: arxiv.org answered 503");
  assert.equal(requests.length, 0, 'no AI call without the text');
  assert.equal((await readText(sql, id)).source, 'arxiv-html', 'stored as retryable, not as abstract-only');

  arxivDown = false;
  const again = await run([id], { paper: id });
  assert.equal(again.status, 'ready');
  assert.equal(again.error, null);
});

test('at the cap the summary fails without calling the AI', async () => {
  const [id] = await add(paper('2310.06825'));
  await writeReading(sql, { prefs: { roomAiCalls: 1 } }, 'test');
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(await useAiCall(sql, day, 1), true);
  const out = await run([id], { paper: id });
  assert.equal(out.status, 'failed');
  assert.equal(out.error, 'Today’s 1 reading-room AI calls are used up. Try again tomorrow.');
  assert.equal(requests.length, 0);
});

test('a reply without the output is asked again once', async () => {
  const [id] = await add(paper('2310.06825'));
  answer = (ids) => (requests.length === 1 ? { nothing: true } : fiveSections(ids));
  const out = await run([id], { paper: id });
  assert.equal(out.status, 'ready');
  assert.equal(requests.length, 2);
});

test('a notebook summary cites each paper by id', async () => {
  const [a, b] = await add(paper('2310.06825'), paper('2310.06826'));
  const notebook = await createNotebook(sql, 'Two');
  await updateNotebook(sql, notebook, { add: a });
  await updateNotebook(sql, notebook, { add: b });
  const out = await run([a, b], { notebook });
  assert.equal(out.status, 'ready');
  assert.deepEqual(out.body!.papers, [a, b]);
  const cited = new Set(out.body!.sections.flatMap((s) => s.claims.flatMap((c) => c.cites.map((x) => x.paper))));
  assert.deepEqual([...cited].sort(), [a, b].sort());
  const pids = await stored([a, b]);
  assert.ok(
    out.body!.sections.every((s) => s.claims.every((c) => c.cites.every((x) => pids.has(`${x.paper}:${x.pid}`)))),
  );
});

test('an empty notebook fails its output plainly', async () => {
  const notebook = await createNotebook(sql, 'Empty');
  const [id] = await add(paper('2310.06825'));
  await updateNotebook(sql, notebook, { add: id });
  const row = await outputRow({ notebook });
  await updateNotebook(sql, notebook, { remove: id });
  await readingRoom({ papers: [], outputId: row.id });
  const out = (await getOutputs(sql, { notebook })).summary!;
  assert.deepEqual([out.status, out.error], ['failed', 'This notebook has no papers yet.']);
});

test('a scan alone is sent as its PDF; in a notebook only its abstract', async () => {
  const [scan, other] = await add(paper('scan', { arxiv: undefined }), paper('2310.06825'));
  await saveText(sql, scan, { source: 'scan', pdf: new Uint8Array([37, 80, 68, 70]), pages: 2 });
  answer = () => ({
    sections: [{ heading: 'Summary', claims: [{ text: 'On page 2.', cites: [`${scan}:page2`, `${scan}:page3`] }] }],
  });
  const alone = await run([scan], { paper: scan });
  assert.equal(alone.status, 'ready');
  assert.deepEqual(alone.body!.sections[0].claims[0].cites, [{ paper: scan, pid: 'page2' }]);
  assert.ok(requests[0].content.some((b) => b.type === 'document'));

  answer = fiveSections;
  const notebook = await createNotebook(sql, 'With a scan');
  await updateNotebook(sql, notebook, { add: scan });
  await updateNotebook(sql, notebook, { add: other });
  const out = await run([scan, other], { notebook });
  assert.equal(out.status, 'ready');
  assert.ok(!requests[1].content.some((b) => b.type === 'document'));
  assert.match(requests[1].prompt, new RegExp(`^\\[${scan}:abs\\.1\\] The abstract of scan\\.$`, 'm'));
});

test('a missing key fails the summary without counting a call', async () => {
  const [id] = await add(paper('2310.06825'));
  delete process.env.ANTHROPIC_API_KEY;
  const out = await run([id], { paper: id });
  assert.equal(out.status, 'failed');
  assert.match(out.error!, /ANTHROPIC_API_KEY/);
  assert.equal(requests.length, 0);
  assert.equal((await sql`select * from reading_ai_use`).length, 0);
});

/** Fake Workflow API: every run is still running, created when it was started. */
function fakeRuns(clock: { now: number }) {
  const started: { papers: number[]; outputId: number | null }[] = [];
  const created = new Map<string, number>();
  const cancelled: string[] = [];
  const runs: RoomRuns = {
    get: (runId) => ({
      status: Promise.resolve('running'),
      createdAt: Promise.resolve(new Date(created.get(runId)!)),
      cancel: async () => void cancelled.push(runId),
    }),
    start: async (job) => {
      started.push(job);
      const runId = `run-${started.length}`;
      created.set(runId, clock.now);
      return { runId };
    },
  };
  return { runs, started, cancelled };
}

test('a second start while running is refused', async () => {
  const [id] = await add(paper('2310.06825'));
  const clock = { now: Date.now() };
  const { runs, started } = fakeRuns(clock);
  assert.deepEqual(await startRoomRun(sql, { paper: id }, 'summary', runs, clock.now), { runId: 'run-1' });
  assert.equal(await startRoomRun(sql, { paper: id }, 'summary', runs, clock.now + 1000), 'running');
  assert.equal(started.length, 1);
  const row = (await getOutputs(sql, { paper: id })).summary!;
  assert.deepEqual([row.status, row.runId], ['running', 'run-1']);
  assert.deepEqual(started[0], { papers: [id], outputId: row.id });
});

test('a run stuck for 15 minutes no longer blocks a new one', async () => {
  const [id] = await add(paper('2310.06825'));
  const clock = { now: Date.now() };
  const { runs, started, cancelled } = fakeRuns(clock);
  await startRoomRun(sql, { paper: id }, 'summary', runs, clock.now);
  clock.now += 14 * 60_000;
  assert.equal(await startRoomRun(sql, { paper: id }, 'summary', runs, clock.now), 'running');
  clock.now += 60_000 + 1;
  assert.deepEqual(await startRoomRun(sql, { paper: id }, 'summary', runs, clock.now), { runId: 'run-2' });
  assert.deepEqual(cancelled, ['run-1']);
  assert.equal(started.length, 2);
});

test('storing the run keeps the last output, and a failed start fails the row', async () => {
  const [id] = await add(paper('2310.06825'));
  await run([id], { paper: id });
  const clock = { now: Date.now() };
  const { runs } = fakeRuns(clock);
  await startRoomRun(sql, { paper: id }, 'summary', runs, clock.now);
  const running = (await getOutputs(sql, { paper: id })).summary!;
  assert.deepEqual([running.status, running.runId, running.body?.sections.length], ['running', 'run-1', 5]);

  const broken: RoomRuns = { get: runs.get, start: async () => Promise.reject(new Error('queue down')) };
  await assert.rejects(startRoomRun(sql, { paper: id }, 'summary', broken, clock.now + 16 * 60_000), /queue down/);
  const failed = (await getOutputs(sql, { paper: id })).summary!;
  assert.deepEqual([failed.status, failed.error, failed.runId], ['failed', 'queue down', null]);
  assert.equal(failed.body?.sections.length, 5, 'the last summary stays');
});

test('Save starts a text-only run', async () => {
  const [id] = await add(paper('2310.06825'));
  const { runs, started } = fakeRuns({ now: Date.now() });
  assert.deepEqual(await startRoomRun(sql, { paper: id }, null, runs), { runId: 'run-1' });
  assert.deepEqual(started, [{ papers: [id], outputId: null }]);
  assert.deepEqual(await getOutputs(sql, { paper: id }), {});
  assert.equal(await startRoomRun(sql, { paper: id + 99 }, null, runs), null);
  assert.equal(await startRoomRun(sql, { notebook: 99 }, 'summary', runs), null);
  assert.equal(await startRoomRun(sql, { notebook: await createNotebook(sql, 'Empty') }, 'summary', runs), 'empty');
  assert.equal(started.length, 1);
});
