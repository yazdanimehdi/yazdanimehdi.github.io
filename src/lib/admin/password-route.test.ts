import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { createAccount } from './accounts';
import { SESSION_COOKIE, openSession } from './session';
import { POST as signIn } from '../../admin/routes/api/auth/password';

let sql: Sql;
const saved = {
  VERCEL: process.env.VERCEL,
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
};
before(async () => {
  sql = pgliteSql();
  await migrate(sql);
  await createAccount(sql, 'jane', 'Jane Smith', 'a long enough password');
  setSqlForTests(sql);
  Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://test', SESSION_SECRET: 's'.repeat(32) });
});
after(() => {
  setSqlForTests(null);
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

function call(body: unknown) {
  const set = new Map<string, string>();
  const res = signIn({
    request: new Request('https://site.test/api/admin/auth/password', { method: 'POST', body: JSON.stringify(body) }),
    cookies: { set: (name: string, value: string) => set.set(name, value) },
  } as never) as Promise<Response>;
  return res.then((r) => ({ res: r, cookie: set.get(SESSION_COOKIE) }));
}

test('right password: 200 and a password session for the account', async () => {
  const { res, cookie } = await call({ username: ' Jane ', password: 'a long enough password' });
  assert.equal(res.status, 200);
  assert.deepEqual(await openSession(cookie!, process.env.SESSION_SECRET!), {
    login: 'jane',
    name: 'Jane Smith',
    avatar: '',
    provider: 'password',
    version: 1,
  });
});

test('wrong password and unknown user: the same 401; bad body 400', async () => {
  for (const body of [
    { username: 'jane', password: 'nope nope nope' },
    { username: 'ghost', password: 'nope nope nope' },
  ]) {
    const { res, cookie } = await call(body);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'Wrong username or password');
    assert.equal(cookie, undefined);
  }
  assert.equal((await call('just a string')).res.status, 400);
});

test('throttled: 429', async () => {
  for (let i = 0; i < 10; i++) await call({ username: 'throttle-me', password: 'nope nope nope' });
  const { res } = await call({ username: 'throttle-me', password: 'nope nope nope' });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /Too many attempts; try again in 15 minutes/);
});

test('before the migration: 503 with the migration message', async () => {
  setSqlForTests(pgliteSql());
  try {
    const { res } = await call({ username: 'jane', password: 'a long enough password' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /run `pnpm db:migrate`/);
  } finally {
    setSqlForTests(sql);
  }
});

test('git mode: 404', async () => {
  delete process.env.DATABASE_URL;
  try {
    assert.equal((await call({ username: 'jane', password: 'a long enough password' })).res.status, 404);
  } finally {
    process.env.DATABASE_URL = 'postgres://test';
  }
});
