import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { setSqlForTests } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { json } from '../admin/http';
import { adminLogin, adminSettings } from '../admin/settings';
import { MemoryStore } from '../admin/memory-store';
import { PostgresStore } from '../admin/postgres-store';
import { careerRoute } from './route';

const GET = careerRoute(async () => json({ ok: true }));
// The owner is whatever config/site.yml names (a GitHub login; forks may edit it).
const owner = adminLogin(adminSettings().owner);
const call = (login: string) =>
  GET({ locals: { user: { login, name: login, avatar: '', provider: 'github' } } } as never) as Promise<Response>;

beforeEach(async () => {
  const sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests((author) => new PostgresStore(sql, author));
});
after(() => {
  setStoreForTests(null);
  setSqlForTests(null);
});

test('a non-owner admin and git mode both get 404', async () => {
  assert.equal((await call(owner)).status, 200);
  const other = await call(`${owner}-other`);
  assert.equal(other.status, 404);
  assert.deepEqual(await other.json(), { error: 'Not found' });
  setStoreForTests(() => new MemoryStore());
  assert.equal((await call(owner)).status, 404);
});
