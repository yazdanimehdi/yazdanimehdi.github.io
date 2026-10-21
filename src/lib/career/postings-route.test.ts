import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { setSqlForTests } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { nonOwnerUser, ownerUser } from './test-owner';
import { PostgresStore } from '../admin/postgres-store';
import { GET } from '../../admin/routes/api/career/postings';

const call = (user: ReturnType<typeof ownerUser>, query = '') =>
  GET({
    locals: { user },
    url: new URL(`http://x/api/admin/career/postings${query}`),
  } as never) as Promise<Response>;

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

test('postings lists for the owner, 404 for others', async () => {
  const ok = await call(ownerUser());
  assert.equal(ok.status, 200);
  const empty = { rows: [], total: 0 };
  assert.deepEqual(await ok.json(), { matches: empty, below: empty, gated: empty, unscored: empty });
  assert.equal((await call(nonOwnerUser())).status, 404);
  assert.equal((await call(ownerUser(), '?status=bogus')).status, 400);
  assert.equal((await call(ownerUser(), '?status=found')).status, 200);
  assert.equal((await call(ownerUser(), '?status=open')).status, 200);
});
