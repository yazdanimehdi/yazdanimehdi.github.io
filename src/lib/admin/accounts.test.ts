import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import type { Sql } from '../db';
import {
  MigrationMissingError,
  changeOwnPassword,
  createAccount,
  deleteAccount,
  listAccounts,
  normalizeUsername,
  resetPassword,
  signIn,
} from './accounts';
import { sessionVersion } from './access';

let sql: Sql;
const PW = 'a long enough password';
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});

test('usernames: trimmed and lowercased; invalid ones refused', () => {
  assert.equal(normalizeUsername('  Jane.Smith '), 'jane.smith');
  for (const bad of ['', 'has space', 'x'.repeat(41), 'semi;colon', 7, '.', '..', ' ... ']) {
    assert.throws(() => normalizeUsername(bad), /Usernames are 1–40/);
  }
});

test('create → list; duplicate (any case) is 409; sign-in works with any spelling of the username', async () => {
  const created = await createAccount(sql, 'Jane', 'Jane Smith', PW);
  assert.equal(created.username, 'jane');
  await assert.rejects(createAccount(sql, ' JANE ', 'Other', PW), /That username is taken/);
  assert.deepEqual(
    (await listAccounts(sql)).map((a) => [a.username, a.name]),
    [['jane', 'Jane Smith']],
  );
  const ok = await signIn(sql, ' JANE ', PW);
  const version = await sessionVersion(sql, 'jane');
  assert.deepEqual(ok, { ok: true, account: { username: 'jane', name: 'Jane Smith', version } });
  assert.deepEqual(await signIn(sql, 'jane', 'wrong password 1'), { ok: false, reason: 'wrong' });
  assert.deepEqual(await signIn(sql, 'nobody', PW), { ok: false, reason: 'wrong' });
  assert.deepEqual(await signIn(sql, 'bad name!', PW), { ok: false, reason: 'wrong' });
});

test('throttle: the 11th try within 15 minutes is refused even with the right password; later it works', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  const t0 = new Date('2026-10-07T12:00:00Z');
  for (let i = 0; i < 10; i++) assert.equal((await signIn(sql, 'jane', 'wrong password 1', t0)).ok, false);
  assert.deepEqual(await signIn(sql, 'jane', PW, t0), { ok: false, reason: 'throttled' });
  const later = new Date(t0.getTime() + 16 * 60 * 1000);
  assert.equal((await signIn(sql, 'jane', PW, later)).ok, true);
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from login_attempts where username = 'jane'`;
  assert.equal(n, 0, 'success clears the attempts');
});

test('reset bumps the session version; change-own checks the current password', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  const v = (await sessionVersion(sql, 'jane'))!;
  await resetPassword(sql, 'jane', 'a brand new password');
  assert.equal(await sessionVersion(sql, 'jane'), v + 1);
  assert.equal((await signIn(sql, 'jane', PW)).ok, false);
  await assert.rejects(changeOwnPassword(sql, 'jane', PW, 'another new password'), /Your current password is wrong/);
  assert.equal(await changeOwnPassword(sql, 'jane', 'a brand new password', 'another new password'), v + 2);
  assert.equal((await signIn(sql, 'jane', 'another new password')).ok, true);
  await assert.rejects(resetPassword(sql, 'nobody', PW), /Not found/);
  assert.equal(await sessionVersion(sql, 'nobody'), null);
});

test('delete: not yourself, not the last account; deleted accounts have no session version', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  await assert.rejects(deleteAccount(sql, 'jane', { provider: 'github', login: 'someone' }), /last account/);
  await createAccount(sql, 'bo', 'Bo', PW);
  await assert.rejects(deleteAccount(sql, 'jane', { provider: 'password', login: 'jane' }), /your own account/);
  await deleteAccount(sql, 'BO', { provider: 'password', login: 'jane' });
  assert.equal(await sessionVersion(sql, 'bo'), null);
});

test('before the migration: MigrationMissingError; sessionVersion answers null', async () => {
  const bare = pgliteSql();
  await assert.rejects(signIn(bare, 'jane', PW), MigrationMissingError);
  assert.equal(await sessionVersion(bare, 'jane'), null);
});

test('throttle holds under concurrency: 40 parallel wrong tries plus the right one', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  const t0 = new Date('2026-10-07T12:00:00Z');
  const results = await Promise.all([
    ...Array.from({ length: 40 }, () => signIn(sql, 'jane', 'wrong password 1', t0)),
    signIn(sql, 'jane', PW, t0),
  ]);
  const throttled = results.filter((r) => !r.ok && r.reason === 'throttled').length;
  assert.ok(throttled >= 30, `throttled ${throttled}`);
  assert.ok(results.filter((r) => r.ok).length <= 1);
});

test('concurrent deletes leave one account', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  await createAccount(sql, 'bo', 'Bo', PW);
  await Promise.allSettled([
    deleteAccount(sql, 'jane', { provider: 'password', login: 'bo' }),
    deleteAccount(sql, 'bo', { provider: 'password', login: 'jane' }),
  ]);
  assert.equal((await listAccounts(sql)).length, 1);
});

test('a deleted and re-created account starts at a new session version: old cookies stay dead', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  await createAccount(sql, 'bo', 'Bo', PW);
  const before = await sessionVersion(sql, 'bo');
  await deleteAccount(sql, 'bo', { provider: 'password', login: 'jane' });
  await createAccount(sql, 'bo', 'Bo', PW);
  assert.notEqual(await sessionVersion(sql, 'bo'), before);
});

test('a password reset lifts the sign-in lockout', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  const t0 = new Date();
  for (let i = 0; i < 10; i++) await signIn(sql, 'jane', 'wrong password 1', t0);
  assert.deepEqual(await signIn(sql, 'jane', PW, t0), { ok: false, reason: 'throttled' });
  await resetPassword(sql, 'jane', 'a brand new password');
  assert.equal((await signIn(sql, 'jane', 'a brand new password', t0)).ok, true);
});
