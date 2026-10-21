import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { setSqlForTests } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { json } from '../admin/http';
import { nonOwnerUser, ownerUser } from './test-owner';
import { MemoryStore } from '../admin/memory-store';
import { PostgresStore } from '../admin/postgres-store';
import { careerRoute } from './route';
import { POST as SUGGEST } from '../../admin/routes/api/career/suggest';

const GET = careerRoute(async () => json({ ok: true }));
// The owner is whatever config/site.yml names (a GitHub login or password account; forks may edit it).
const call = (user: ReturnType<typeof ownerUser>) => GET({ locals: { user } } as never) as Promise<Response>;

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
  assert.equal((await call(ownerUser())).status, 200);
  const other = await call(nonOwnerUser());
  assert.equal(other.status, 404);
  assert.deepEqual(await other.json(), { error: 'Not found' });
  setStoreForTests(() => new MemoryStore());
  assert.equal((await call(ownerUser())).status, 404);
});

test('suggest is owner-only and needs a CV', async () => {
  const suggest = (user: ReturnType<typeof ownerUser>) => SUGGEST({ locals: { user } } as never) as Promise<Response>;
  assert.equal((await suggest(nonOwnerUser())).status, 404);
  const none = await suggest(ownerUser());
  assert.equal(none.status, 400);
  assert.deepEqual(await none.json(), { error: 'There is no CV yet: add one on the CV screen' });
});
