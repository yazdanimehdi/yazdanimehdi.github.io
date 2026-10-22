import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPosting, readCareer, updatePosting, writeCareer } from '../lib/career/db';
import { setApplySandboxForTests } from '../lib/career/apply/sandbox';
import {
  approvedApp,
  fakeSandbox,
  ok,
  posting,
  readyApp,
  setUp,
  tearDown,
  type Kit,
} from '../lib/career/apply/test-kit';
import {
  approve,
  approveAll,
  careerPrefill,
  careerSubmitQueue,
  ensureSubmitQueue,
  setApplyRunsForTests,
  skipApplication,
  startPrefill,
  type ApplyRuns,
} from './career-apply';

let kit: Kit;
beforeEach(async () => {
  kit = await setUp();
});
afterEach(() => {
  setApplyRunsForTests(null);
  tearDown();
});

function fakeRuns(status = 'running') {
  const seen = { prefill: [] as number[], queue: 0 };
  const runs: ApplyRuns = {
    get: () => ({
      status: Promise.resolve(status),
      createdAt: Promise.resolve(new Date()),
      cancel: async () => {},
    }),
    prefill: async (id) => (seen.prefill.push(id), { runId: `wrun_prefill_${id}` }),
    queue: async () => (seen.queue++, { runId: 'wrun_queue' }),
  };
  return { runs, seen };
}

test('prefill refuses a posting with no tailored CV', async () => {
  const id = await posting(kit.sql, null, false);
  const { runs, seen } = fakeRuns();
  assert.equal(await startPrefill(kit.sql, id, runs), 'no-draft');
  assert.deepEqual(seen.prefill, []);
  assert.equal((await getPosting(kit.sql, id))!.application, null);
});

test('startPrefill claims the posting and starts one run', async () => {
  const id = await posting(kit.sql);
  const { runs, seen } = fakeRuns();
  assert.deepEqual(await startPrefill(kit.sql, id, runs), { runId: `wrun_prefill_${id}` });
  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.application?.state, 'prefilling');
  assert.equal(p.application?.url, p.applyUrl);
  assert.equal(p.applyRunId, `wrun_prefill_${id}`);
  assert.equal(await startPrefill(kit.sql, id, runs), 'running', 'a second click');
  assert.deepEqual(seen.prefill, [id]);
});

test('prefill is refused once an application is approved or may have been sent', async () => {
  for (const state of ['approved', 'submitting', 'submitted', 'unconfirmed'] as const) {
    const id = await posting(kit.sql, approvedApp({ state }));
    const { runs, seen } = fakeRuns();
    assert.equal(await startPrefill(kit.sql, id, runs), 'locked', state);
    assert.deepEqual(seen.prefill, [], state);
    assert.equal((await getPosting(kit.sql, id))!.application?.state, state);
  }
});

test('only one apply sandbox runs at a time', async () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const other = await posting(kit.sql, { ...readyApp(), state: 'prefilling', at: minutesAgo(1) });
  const id = await posting(kit.sql);
  const { runs, seen } = fakeRuns();
  assert.equal(await startPrefill(kit.sql, id, runs), 'busy');
  await updatePosting(kit.sql, other, { application: { ...readyApp(), state: 'submitting', at: minutesAgo(1) } });
  assert.equal(await startPrefill(kit.sql, id, runs), 'busy', 'a submit runs');
  await updatePosting(kit.sql, other, { application: { ...readyApp(), state: 'prefilling', at: minutesAgo(16) } });
  assert.deepEqual(await startPrefill(kit.sql, id, runs), { runId: `wrun_prefill_${id}` }, 'a stale one');
  assert.deepEqual(seen.prefill, [id]);
});

test('approve rejects values for ids the form does not have', async () => {
  const id = await posting(kit.sql, readyApp());
  const { runs, seen } = fakeRuns();
  const fields = readyApp().fields.map(({ id: fid, value }) => ({ id: fid, value }));
  const by = 'ada';
  assert.equal(await approve(kit.sql, id, [...fields, { id: 'extra', value: 'x' }], by, runs), 'changed-values');
  assert.equal(await approve(kit.sql, id, fields.slice(1), by, runs), 'changed-values', 'one missing');
  assert.equal(await approve(kit.sql, id, [...fields.slice(1), fields[1]], by, runs), 'changed-values', 'a duplicate');
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'ready');
  assert.equal(seen.queue, 0);
});

test('approve stores the owner’s values over the server’s field shapes and starts the queue', async () => {
  const id = await posting(kit.sql, readyApp());
  const { runs, seen } = fakeRuns();
  const fields = readyApp().fields.map((f) => ({
    ...f,
    value: f.id === 'why' ? 'Edited.' : f.value,
    label: 'tampered',
    required: false,
  }));
  assert.equal(await approve(kit.sql, id, fields, 'ada', runs), 'ok');
  const app = (await getPosting(kit.sql, id))!.application!;
  assert.equal(app.state, 'approved');
  assert.equal(app.approved?.by, 'ada');
  assert.deepEqual(
    app.approved?.fields.map((f) => [f.id, f.label, f.value, f.source]),
    readyApp().fields.map((f) => [
      f.id,
      f.label,
      f.id === 'why' ? 'Edited.' : f.value,
      f.id === 'why' ? 'owner' : f.source,
    ]),
  );
  assert.equal(seen.queue, 1);
  assert.equal((await readCareer(kit.sql)).applyQueueRunId, 'wrun_queue');
  assert.equal(await approve(kit.sql, id, fields, 'ada', runs), 'not-ready', 'approving twice');
});

test('approve-all approves each ready posting individually and reports the rest', async () => {
  const a = await posting(kit.sql, readyApp());
  const b = await posting(kit.sql, readyApp());
  const c = await posting(kit.sql, approvedApp({ state: 'unconfirmed' }));
  for (const id of [a, b, c]) await updatePosting(kit.sql, id, { status: 'ready' });
  const { runs, seen } = fakeRuns();
  const out = await approveAll(kit.sql, 'ada', runs);
  assert.deepEqual(out.approved.sort(), [a, b].sort());
  assert.deepEqual(out.skipped, [{ id: c, reason: 'not-ready' }]);
  assert.equal((await getPosting(kit.sql, c))!.application?.state, 'unconfirmed', 'never re-approved');
  assert.equal(seen.queue, 1, 'one queue for all of them');
});

test('ensureSubmitQueue starts no second queue while one runs, and a new one once it ended', async () => {
  const running = fakeRuns('running');
  await ensureSubmitQueue(kit.sql, running.runs);
  await ensureSubmitQueue(kit.sql, running.runs);
  assert.equal(running.seen.queue, 1);
  const done = fakeRuns('completed');
  await ensureSubmitQueue(kit.sql, done.runs);
  assert.equal(done.seen.queue, 1);
});

test('the submit queue drains approved postings one at a time and releases itself', async () => {
  const a = await posting(kit.sql, approvedApp());
  const b = await posting(kit.sql, approvedApp());
  const ready = await posting(kit.sql, readyApp());
  await writeCareer(kit.sql, { applyQueueRunId: 'wrun_queue' }, 'test');
  let inFlight = 0;
  const sb = fakeSandbox((input) => {
    assert.equal(++inFlight, 1, 'one at a time');
    inFlight--;
    return ok(input);
  });
  setApplySandboxForTests(sb.api);

  assert.equal(await careerSubmitQueue(), 2);

  assert.equal((await getPosting(kit.sql, a))!.application?.state, 'submitted');
  assert.equal((await getPosting(kit.sql, b))!.application?.state, 'submitted');
  assert.equal((await getPosting(kit.sql, ready))!.application?.state, 'ready', 'not approved, not sent');
  assert.equal(sb.inputs.length, 2);
  assert.equal((await readCareer(kit.sql)).applyQueueRunId, null);
});

test('skip withdraws an approval before the queue reaches it', async () => {
  const id = await posting(kit.sql, approvedApp());
  assert.equal(await skipApplication(kit.sql, id), 'ok');
  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.status, 'skipped');
  assert.equal(p.application?.state, 'ready');
  assert.equal(p.application?.approved, undefined);
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);
  assert.equal(await careerSubmitQueue(), 0);
  assert.equal(sb.inputs.length, 0);
});

test('careerPrefill marks a failed pre-fill failed', async () => {
  const id = await posting(kit.sql);
  const { runs } = fakeRuns();
  await startPrefill(kit.sql, id, runs);
  setApplySandboxForTests(fakeSandbox((input) => ({ ...ok(input), ok: false, error: 'page crashed' })).api);
  await careerPrefill(id);
  const app = (await getPosting(kit.sql, id))!.application!;
  assert.equal(app.state, 'failed');
  assert.match(app.reason ?? '', /page crashed/);
});
