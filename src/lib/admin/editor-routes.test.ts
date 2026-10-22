import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setSandboxForTests, waitingForReview, type SandboxApi, type SandboxHandle } from './editor';
import { UpstreamError } from './store';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { adminSettings } from './settings';
import { DELETE as discard } from '../../admin/routes/api/editor/changes';
import { POST as publishRoute } from '../../admin/routes/api/editor/publish';
import { POST as revertRoute } from '../../admin/routes/api/editor/revert';
import { DELETE as stop, POST as run } from '../../admin/routes/api/editor/runs';
import { POST as startOverRoute } from '../../admin/routes/api/editor/start-over';
import { POST as undoRoute } from '../../admin/routes/api/editor/undo-publish';
import { GET as deployment } from '../../admin/routes/api/editor/deployment';
import { DELETE as end, GET as status, POST as start } from '../../admin/routes/api/editor/session';

const ENV = [
  'VERCEL',
  'DATABASE_URL',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'ANTHROPIC_API_KEY',
  'VERCEL_GIT_COMMIT_SHA',
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
let created: string[];

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, { VERCEL: '1', GITHUB_TOKEN: 'ghp_x', GITHUB_REPO: 'jane/site', ANTHROPIC_API_KEY: 'sk' });
  const store = new MemoryStore();
  setStoreForTests(() => store);
  created = [];
  setSandboxForTests({
    get: async () => null,
    create: async (name) => {
      created.push(name);
      throw new Error('not in this test');
    },
  } satisfies SandboxApi);
});
afterEach(() => {
  setSandboxForTests(null);
  adminSettings().publishers = [];
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

const user = { login: 'jane', name: 'Jane', avatar: '' };
async function call(handler: (ctx: never) => Response | Promise<Response>, method: string, signedIn = true) {
  const url = new URL('https://site.test/api/admin/editor/x');
  const request = new Request(url, { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
  const res = await handler({ request, url, params: {}, locals: signedIn ? { user } : {} } as never);
  return { status: res.status, body: await res.json() };
}

test('every editor route needs a session', async () => {
  for (const [handler, method] of [
    [status, 'GET'],
    [start, 'POST'],
    [end, 'DELETE'],
    [run, 'POST'],
    [stop, 'DELETE'],
    [discard, 'DELETE'],
    [revertRoute, 'POST'],
    [publishRoute, 'POST'],
    [startOverRoute, 'POST'],
    [undoRoute, 'POST'],
    [deployment, 'GET'],
  ] as const) {
    assert.equal((await call(handler, method, false)).status, 401, `${method} ${handler.name}`);
  }
});

test('a static build has no editor: status says why, Start is a 404', async () => {
  delete process.env.VERCEL;
  const s = await call(status, 'GET');
  assert.equal(s.body.state, 'unavailable');
  assert.match(s.body.reason, /admin on Vercel/);
  assert.equal((await call(start, 'POST')).status, 404);
});

test('no GITHUB_TOKEN: status says so, Start is a 400 and creates nothing', async () => {
  delete process.env.GITHUB_TOKEN;
  const s = await call(status, 'GET');
  assert.deepEqual(s.body.state, 'unavailable');
  assert.match(s.body.reason, /GITHUB_TOKEN is not set/);
  const res = await call(start, 'POST');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /GITHUB_TOKEN/);
  assert.deepEqual(created, []);
});

test('no key for the configured provider: status names it, Start and Run are 400s, nothing is created', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const s = await call(status, 'GET');
  assert.equal(s.body.state, 'none');
  assert.match(s.body.blocked, /ANTHROPIC_API_KEY is not set: add it on the Integrations screen/);
  for (const handler of [start, run, startOverRoute, undoRoute]) {
    const res = await call(handler, 'POST');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ANTHROPIC_API_KEY/);
  }
  assert.deepEqual(created, []);
});

test('with everything set, Start reaches the sandbox for this repository', async () => {
  const res = await call(start, 'POST');
  assert.equal(res.status, 500, 'the stub refuses');
  assert.deepEqual(created, ['site-editor-jane-site']);
  assert.deepEqual((await call(status, 'GET')).body, { state: 'none' });
});

test('when the sandbox service can’t be reached, status says why instead of failing', async () => {
  setSandboxForTests({
    get: async () => {
      throw new UpstreamError(
        'Vercel Sandbox: looking up the session failed: Could not get credentials from OIDC context',
      );
    },
    create: async () => {
      throw new Error('unused');
    },
  });
  const s = await call(status, 'GET');
  assert.equal(s.status, 200);
  assert.deepEqual(s.body, {
    state: 'unavailable',
    reason: 'Vercel Sandbox: looking up the session failed: Could not get credentials from OIDC context',
  });
});

test('deployment reports the commit this deployment was built from, or null off Vercel', async () => {
  assert.deepEqual((await call(deployment, 'GET')).body, { commit: null });
  process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
  assert.deepEqual((await call(deployment, 'GET')).body, { commit: 'abc123' });
});

test('publishers: only they may publish or undo a publish; everyone else gets a 403 and the session stays shared', async () => {
  adminSettings().publishers = ['priya'];
  for (const handler of [publishRoute, undoRoute]) {
    const res = await call(handler, 'POST');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Only the site’s publishers can publish. Your changes are saved for them to review.');
  }
  assert.equal((await call(start, 'POST')).status, 500, 'Start still reaches the sandbox');

  adminSettings().publishers = ['jane'];
  assert.equal((await call(publishRoute, 'POST')).status, 409, 'past the check: no session is running');
  assert.equal((await call(undoRoute, 'POST')).status, 400, 'past the check: no publish named');
});

test('the Dashboard reads who waits for review from the sandbox’s tag, without resuming it', async () => {
  const asked: unknown[] = [];
  setSandboxForTests({
    get: async (_name, opts) => {
      asked.push(opts);
      return { status: 'stopped', tags: { review: 'Jane,Priya%20Rao%2C%20PhD' } } as unknown as SandboxHandle;
    },
    create: async () => {
      throw new Error('unused');
    },
  });
  assert.deepEqual(await waitingForReview(), ['Jane', 'Priya Rao, PhD']);
  assert.deepEqual(asked, [undefined], 'a plain lookup: a stopped sandbox stays stopped');
  delete process.env.GITHUB_TOKEN;
  assert.deepEqual(await waitingForReview(), [], 'no editor here: nothing to review');
});
