import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { createAccount, resetPassword } from './accounts';
import { isAllowed } from './access';

let sql: Sql;
const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
before(async () => {
  sql = pgliteSql();
  await migrate(sql);
  await createAccount(sql, 'jane', 'Jane', 'a long enough password');
  setSqlForTests(sql);
  Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://test' });
});
after(() => {
  setSqlForTests(null);
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

const pw = (login: string, version: number) => ({
  login,
  name: login,
  avatar: '',
  provider: 'password' as const,
  version,
});
const gh = (login: string) => ({ login, name: login, avatar: '', provider: 'github' as const });

test('password sessions: allowed while the account exists and the version matches', async () => {
  assert.equal(await isAllowed(pw('jane', 1), []), true);
  assert.equal(await isAllowed(pw('jane', 0), []), false);
  assert.equal(await isAllowed(pw('ghost', 1), []), false);
  await resetPassword(sql, 'jane', 'a different long password');
  assert.equal(await isAllowed(pw('jane', 1), []), false, 'a reset ends older sessions');
  assert.equal(await isAllowed(pw('jane', 2), []), true);
});

test('providers never vouch for each other', async () => {
  assert.equal(await isAllowed(gh('jane'), []), false, 'a password account name is not a GitHub admin');
  assert.equal(
    await isAllowed(pw('janesmith', 1), ['janesmith']),
    false,
    'adminUsers does not admit a password session',
  );
  assert.equal(await isAllowed(gh('janesmith'), ['janesmith']), true);
});

test('git mode: password sessions are never allowed', async () => {
  delete process.env.DATABASE_URL;
  try {
    assert.equal(await isAllowed(pw('jane', 2), []), false);
  } finally {
    process.env.DATABASE_URL = 'postgres://test';
  }
});

test('an unreachable database throws (the middleware answers 503)', async () => {
  setSqlForTests((async () => {
    throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
  }) as unknown as Sql);
  try {
    await assert.rejects(isAllowed(pw('jane', 2), []), /down/);
  } finally {
    setSqlForTests(sql);
  }
});
