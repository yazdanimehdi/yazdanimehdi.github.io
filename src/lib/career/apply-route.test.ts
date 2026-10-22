import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST as apply } from '../../admin/routes/api/career/postings/[id]/apply';
import { POST as approveAll } from '../../admin/routes/api/career/approve-all';
import { setApplyRunsForTests } from '../../workflows/career-apply';
import { getPosting, updatePosting } from './db';
import { posting, readyApp, setUp, tearDown, type Kit } from './apply/test-kit';
import { nonOwnerUser, ownerUser } from './test-owner';

let kit: Kit;
const started: number[] = [];
beforeEach(async () => {
  kit = await setUp();
  started.length = 0;
  setApplyRunsForTests({
    get: () => ({ status: Promise.resolve('running'), createdAt: Promise.resolve(new Date()), cancel: async () => {} }),
    prefill: async (id) => (started.push(id), { runId: 'wrun_p' }),
    queue: async () => ({ runId: 'wrun_q' }),
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

test('approve with a stale field set is a 409 and approves nothing', async () => {
  const id = await posting(kit.sql, readyApp());
  const fields = readyApp()
    .fields.slice(1)
    .map(({ id: fid, value }) => ({ id: fid, value }));
  const res = await call(apply, ownerUser(), String(id), { action: 'approve', fields });
  assert.equal(res.status, 409);
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'ready');
});

test('approve, prefill and handoff through the route', async () => {
  const id = await posting(kit.sql, readyApp());
  const fields = readyApp().fields.map(({ id: fid, value }) => ({ id: fid, value }));
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'approve', fields })).status, 200);
  assert.equal((await getPosting(kit.sql, id))!.application?.state, 'approved');
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'prefill' })).status, 409, 'approved: locked');

  const fresh = await posting(kit.sql, null, false);
  assert.equal((await call(apply, ownerUser(), String(fresh), { action: 'prefill' })).status, 400, 'no CV');
  await updatePosting(kit.sql, fresh, { cvPdfUrl: 'https://blob.test/cv.pdf' });
  assert.equal((await call(apply, ownerUser(), String(fresh), { action: 'prefill' })).status, 200);
  assert.deepEqual(started, [fresh]);

  const res = await call(apply, ownerUser(), String(fresh), { action: 'handoff' });
  assert.equal(res.status, 200);
  const app = (await getPosting(kit.sql, fresh))!.application!;
  assert.equal(app.state, 'handoff');
  assert.equal(app.reason, 'You chose to finish this one yourself');
  assert.equal((await call(apply, ownerUser(), '999999', { action: 'prefill' })).status, 404);
  assert.equal((await call(apply, ownerUser(), String(id), { action: 'nope' })).status, 400);
});

test('approve-all reports what it approved and skipped', async () => {
  const id = await posting(kit.sql, readyApp());
  await updatePosting(kit.sql, id, { status: 'ready' });
  const res = await call(approveAll, ownerUser(), '', {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { approved: [id], skipped: [] });
});
