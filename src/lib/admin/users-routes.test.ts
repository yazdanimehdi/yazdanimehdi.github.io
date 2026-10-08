import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { PostgresStore } from './postgres-store';
import { createAccount, signIn } from './accounts';
import { sessionVersion } from './access';
import { SESSION_COOKIE, openSession } from './session';
import { GET as list, POST as create } from '../../admin/routes/api/users';
import { DELETE as remove, PUT as reset } from '../../admin/routes/api/users/[username]';
import { POST as changeOwn } from '../../admin/routes/api/account/password';

let sql: Sql;
const saved = {
  VERCEL: process.env.VERCEL,
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
};
const PW = 'a long enough password';
before(() =>
  Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://test', SESSION_SECRET: 's'.repeat(32) }),
);
after(() => {
  setSqlForTests(null);
  setStoreForTests(null);
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  await createAccount(sql, 'jane', 'Jane', PW);
  setSqlForTests(sql);
  setStoreForTests(
    (a) => new PostgresStore(sql, a, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
});

const me = { login: 'jane', name: 'Jane', avatar: '', provider: 'password' as const, version: 1 };
function call(
  handler: (ctx: never) => Response | Promise<Response>,
  opts: { method?: string; params?: Record<string, string>; body?: unknown; user?: unknown } = {},
) {
  const set = new Map<string, string>();
  const url = new URL('https://site.test/api/admin/x');
  const request = new Request(url, {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return Promise.resolve(
    handler({
      request,
      url,
      params: opts.params ?? {},
      locals: { user: opts.user ?? me },
      cookies: { set: (n: string, v: string) => set.set(n, v) },
    } as never),
  ).then((res) => ({ res, cookie: set.get(SESSION_COOKIE) }));
}

test('list, create (201, 409 on duplicate), reset bumps the version, delete', async () => {
  const listed = await (await call(list)).res.json();
  assert.deepEqual(
    listed.accounts.map((a: { username: string }) => a.username),
    ['jane'],
  );
  assert.ok(Array.isArray(listed.githubAdmins));
  assert.equal(
    (await call(create, { method: 'POST', body: { username: 'Bo', name: 'Bo Li', password: PW } })).res.status,
    201,
  );
  assert.equal(
    (await call(create, { method: 'POST', body: { username: 'bo', name: 'X', password: PW } })).res.status,
    409,
  );
  assert.equal(
    (await call(create, { method: 'POST', body: { username: 'cy', name: 'C', password: 'short' } })).res.status,
    400,
  );
  assert.equal(
    (await call(reset, { method: 'PUT', params: { username: 'bo' }, body: { password: 'a new long password' } })).res
      .status,
    200,
  );
  assert.equal(await sessionVersion(sql, 'bo'), 2);
  assert.equal(
    (await call(remove, { method: 'DELETE', params: { username: 'jane' } })).res.status,
    409,
    'not yourself',
  );
  assert.equal((await call(remove, { method: 'DELETE', params: { username: 'bo' } })).res.status, 200);
  assert.equal(await sessionVersion(sql, 'bo'), null);
});

test('change own password: wrong current 400; success re-seals this session with the new version', async () => {
  assert.equal(
    (await call(changeOwn, { method: 'POST', body: { current: 'wrong wrong wrong', next: 'another long password' } }))
      .res.status,
    400,
  );
  const { res, cookie } = await call(changeOwn, {
    method: 'POST',
    body: { current: PW, next: 'another long password' },
  });
  assert.equal(res.status, 200);
  const session = await openSession(cookie!, process.env.SESSION_SECRET!);
  assert.equal(session?.version, 2);
  assert.equal((await signIn(sql, 'jane', 'another long password')).ok, true);
});

test('GitHub sessions cannot change "their" password; git mode answers 404', async () => {
  const gh = { login: 'jane', name: 'Jane', avatar: '', provider: 'github' as const };
  assert.equal(
    (await call(changeOwn, { method: 'POST', body: { current: PW, next: 'x'.repeat(12) }, user: gh })).res.status,
    404,
  );
  setStoreForTests(() => new MemoryStore());
  assert.equal((await call(list)).res.status, 404);
});
