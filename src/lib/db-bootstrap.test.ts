import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { signIn } from './admin/accounts';
import { bootstrap, firstAdminUsername, type Upload } from './db-bootstrap';
import { pgliteSql } from './pglite-sql';

const ROOT = path.resolve(import.meta.dirname, '../..');
const upload: Upload = async (filename) => `https://blob.test/${filename}`;
const env = { ADMIN_PASSWORD: 'a long enough password', VERCEL_GIT_REPO_OWNER: 'JaneSmith' };

test('bootstrap: a fresh database gets tables, the repo content and the first account; a rerun changes nothing', async () => {
  const sql = pgliteSql();
  const first = await bootstrap(sql, ROOT, env, upload);
  assert.ok(first.some((l) => l.startsWith('migrations applied')));
  assert.ok(first.some((l) => l.startsWith('content copied')));
  assert.ok(first.includes('admin account created: janesmith'));
  const [{ count }] = await sql<{ count: number }>`select count(*)::int as count from documents`;
  assert.ok(count > 0);
  assert.equal((await signIn(sql, 'janesmith', env.ADMIN_PASSWORD, new Date(), '')).ok, true);

  await sql`update documents set content = 'edited' where path = 'config/site.yml'`;
  assert.deepEqual(await bootstrap(sql, ROOT, { ...env, ADMIN_PASSWORD: 'another long password' }, upload), []);
  const [site] = await sql<{ content: string }>`select content from documents where path = 'config/site.yml'`;
  assert.equal(site.content, 'edited', 'existing content is never overwritten');
});

test('bootstrap: no ADMIN_PASSWORD leaves no account; a short one fails the build', async () => {
  const sql = pgliteSql();
  const log = await bootstrap(sql, ROOT, {}, upload);
  assert.ok(log.some((l) => l.startsWith('no admin account')));
  await assert.rejects(bootstrap(sql, ROOT, { ADMIN_PASSWORD: 'short' }, upload), /ADMIN_PASSWORD/);
});

test('firstAdminUsername: ADMIN_USERNAME, else the repo owner, lowercased', () => {
  assert.equal(firstAdminUsername({ ADMIN_USERNAME: 'Mehdi', VERCEL_GIT_REPO_OWNER: 'x' }), 'mehdi');
  assert.equal(firstAdminUsername({ VERCEL_GIT_REPO_OWNER: 'YazdaniMehdi' }), 'yazdanimehdi');
  assert.equal(firstAdminUsername({}), 'admin');
});
