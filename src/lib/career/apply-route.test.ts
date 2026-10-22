import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST as apply } from '../../admin/routes/api/career/postings/[id]/apply';
import { POST as approveAll } from '../../admin/routes/api/career/approve-all';
import { PATCH } from '../../admin/routes/api/career/postings/[id]';
import { careerSubmitQueue, setApplyRunsForTests } from '../../workflows/career-apply';
import { getPosting, listEvents, updatePosting } from './db';
import { setApplySandboxForTests } from './apply/sandbox';
import { approvedApp, fakeSandbox, ok, posting, readyApp, setUp, tearDown, type Kit } from './apply/test-kit';
import { nonOwnerUser, ownerUser } from './test-owner';

let kit: Kit;
const started: number[] = [];
let queueDown = false;
beforeEach(async () => {
  kit = await setUp();
  started.length = 0;
  queueDown = false;
  setApplyRunsForTests({
    get: () => ({ status: Promise.resolve('running'), createdAt: Promise.resolve(new Date()), cancel: async () => {} }),
    prefill: async (id) => (started.push(id), { runId: 'wrun_p' }),
    queue: async () => {
      if (queueDown) throw new Error('workflow down');
      return { runId: 'wrun_q' };
    },
  });
});
afterEach(() => {
  setApplyRunsForTests(null);
  tearDown();
});

const call = (fn: typeof apply, user: ReturnType<typeof ownerUser>, id: string, body: unknown) =>
  fn({
    locals: { user },
    params: { id },
    request: new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }),
    url: new URL('http://x/'),
  } as never) as Promise<Response>;

test('apply routes are the owner’s only', async () => {
  const id = String(await posting(kit.sql, readyApp()));
  assert.equal((await call(apply, nonOwnerUser(), id, { action: 'prefill' })).status, 404);
  assert.equal((await call(approveAll, nonOwnerUser(), '', {})).status, 404);
  assert.deepEqual(started, []);
});

const values = (app: { fields: { id: string; value: string }[] }) =>
  app.fields.map(({ id: fid, value }) => ({ id: fid, value }));

test('approve with a stale field set is a 409 and approves nothing', async () => {
  const app = readyApp();
  const id = await posting(kit.sql, app);
  const fields = values(app).slice(1);
  const res = await call(apply, ownerUser(), String(id), { action: 'approve', at: app.at, fields });
  assert.equal(res.status, 409);
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'ready');
});

test('approve names the pre-fill it saw: another one’s `at` is a 409, a missing one a 400', async () => {
  const app = readyApp();
  const id = await posting(kit.sql, app);
  const older = new Date(Date.parse(app.at) - 60_000).toISOString();
  const stale = await call(apply, ownerUser(), String(id), { action: 'approve', at: older, fields: values(app) });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /reload/);
  const missing = await call(apply, ownerUser(), String(id), { action: 'approve', fields: values(app) });
  assert.equal(missing.status, 400);
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'ready');
});

test('an approval stands when the submit queue can’t start: 200 with queued false', async () => {
  const app = readyApp();
  const id = await posting(kit.sql, app);
  queueDown = true;
  const res = await call(apply, ownerUser(), String(id), { action: 'approve', at: app.at, fields: values(app) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.queued, false);
  assert.equal(body.application.state, 'approved');
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'approved');
});

test('approve, prefill and handoff through the route', async () => {
  const app = readyApp();
  const id = await posting(kit.sql, app);
  const res0 = await call(apply, ownerUser(), String(id), { action: 'approve', at: app.at, fields: values(app) });
  assert.equal(res0.status, 200);
  assert.equal((await res0.json()).queued, true);
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'approved');
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'prefill' })).status, 409, 'approved: locked');

  const fresh = await posting(kit.sql, null, false);
  assert.equal((await call(apply, ownerUser(), String(fresh), { action: 'prefill' })).status, 400, 'no CV');
  await updatePosting(kit.sql, fresh, { cvPdfUrl: 'https://blob.test/cv.pdf' });
  assert.equal((await call(apply, ownerUser(), String(fresh), { action: 'prefill' })).status, 200);
  assert.deepEqual(started, [fresh]);

  const res = await call(apply, ownerUser(), String(fresh), { action: 'handoff' });
  assert.equal(res.status, 200);
  const handedOff = (await getPosting(kit.sql, fresh))!.application!;
  assert.equal(handedOff.state, 'handoff');
  assert.equal(handedOff.reason, 'You chose to finish this one yourself');
  assert.equal((await call(apply, ownerUser(), '999999', { action: 'prefill' })).status, 404);
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'nope' })).status, 400);
});

test('approve-all reports what it approved and skipped', async () => {
  const app = readyApp();
  const id = await posting(kit.sql, app);
  await updatePosting(kit.sql, id, { status: 'ready' });
  const res = await call(approveAll, ownerUser(), '', { items: [{ id, at: app.at }] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { approved: [id], skipped: [], queued: true });
});

test('approve-all needs the list the owner saw: no body, or more than 200 items, is a 400', async () => {
  const id = await posting(kit.sql, readyApp());
  await updatePosting(kit.sql, id, { status: 'ready' });
  assert.equal((await call(approveAll, ownerUser(), '', {})).status, 400);
  const items = Array.from({ length: 201 }, () => ({ id, at: 'x' }));
  assert.equal((await call(approveAll, ownerUser(), '', { items })).status, 400);
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'ready');
});

test('withdraw returns an approval the queue hasn’t claimed to ready and keeps the status', async () => {
  const id = await posting(kit.sql, approvedApp());
  await updatePosting(kit.sql, id, { status: 'ready' });
  const res = await call(apply, ownerUser(), String(id), { action: 'withdraw' });
  assert.equal(res.status, 200);
  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.application?.state, 'ready');
  assert.equal(p.application?.approved, undefined, 'the approved values are gone');
  assert.equal(p.status, 'ready');
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'withdraw' })).status, 409, 'nothing to withdraw');
  const sending = await posting(kit.sql, approvedApp({ state: 'submitting' }));
  assert.equal((await call(apply, ownerUser(), String(sending), { action: 'withdraw' })).status, 409);
  assert.equal((await getPosting(kit.sql, sending))!.application?.state, 'submitting');
});

const unconfirmed = () => approvedApp({ state: 'unconfirmed', reason: 'Submitted, but the page didn’t confirm it' });

test('confirm: the owner says an unconfirmed application went out', async () => {
  const id = await posting(kit.sql, unconfirmed());
  await updatePosting(kit.sql, id, { status: 'ready' });
  const res = await call(apply, ownerUser(), String(id), { action: 'confirm' });
  assert.equal(res.status, 200);
  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.application?.state, 'submitted');
  assert.equal(p.application?.reason, undefined);
  assert.equal(p.status, 'submitted');
  const details = (await listEvents(kit.sql, id)).map((e) => e.detail);
  assert.ok(details.includes('submitted: you confirmed it'), String(details));
  assert.ok(details.includes('ready → submitted'));
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'confirm' })).status, 409, 'only once');
});

test('not-sent: the owner says it wasn’t sent, and a new pre-fill is allowed', async () => {
  const id = await posting(kit.sql, unconfirmed());
  await updatePosting(kit.sql, id, { status: 'ready' });
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'prefill' })).status, 409, 'unconfirmed: locked');
  const res = await call(apply, ownerUser(), String(id), { action: 'not-sent' });
  assert.equal(res.status, 200);
  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.application?.state, 'failed');
  assert.equal(p.application?.reason, 'You said it wasn’t sent');
  assert.equal(p.status, 'ready');
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'prefill' })).status, 200);
  assert.deepEqual(started, [id]);
});

test('confirm and not-sent are refused unless the application is unconfirmed', async () => {
  for (const app of [readyApp(), approvedApp(), approvedApp({ state: 'submitting' })]) {
    const id = await posting(kit.sql, app);
    for (const action of ['confirm', 'not-sent']) {
      assert.equal((await call(apply, ownerUser(), String(id), { action })).status, 409, `${app.state} ${action}`);
    }
    assert.equal((await getPosting(kit.sql, id))!.application?.state, app.state);
  }
});

test('PATCH status away from ready withdraws an approval before the queue claims it', async () => {
  const id = await posting(kit.sql, approvedApp());
  await updatePosting(kit.sql, id, { status: 'ready' });
  assert.equal((await call(PATCH, ownerUser(), String(id), { status: 'skipped' })).status, 200);
  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.status, 'skipped');
  assert.equal(p.application?.state, 'ready');
  assert.equal(p.application?.approved, undefined);
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);
  assert.equal(await careerSubmitQueue(), 0);
  assert.equal(sb.inputs.length, 0, 'nothing sent');
});

test('PATCH status on an application that may have gone out changes the status only', async () => {
  for (const state of ['submitting', 'submitted', 'unconfirmed'] as const) {
    const app = approvedApp({ state });
    const id = await posting(kit.sql, app);
    await updatePosting(kit.sql, id, { status: 'ready' });
    assert.equal((await call(PATCH, ownerUser(), String(id), { status: 'withdrawn' })).status, 200);
    const p = (await getPosting(kit.sql, id))!;
    assert.equal(p.status, 'withdrawn', state);
    assert.deepEqual(p.application, app, state);
  }
});
