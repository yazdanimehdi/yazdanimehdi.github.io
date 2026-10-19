import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { PostgresStore } from './postgres-store';
import { backupToGit } from './backup';
import { getSecret, listSecrets, openSecret, sealSecret, setSecret } from './secrets';
import type { Change } from './store';
import { GET as listKeys, PUT as putKey } from '../../admin/routes/api/ai/keys';

const A = 'a'.repeat(32);
const KEY = 'sk-live-0123456789abcd';
const saved = { SESSION_SECRET: process.env.SESSION_SECRET, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
let sql: Sql;

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  process.env.SESSION_SECRET = A;
  delete process.env.OPENAI_API_KEY;
  setSqlForTests(sql);
  setStoreForTests(
    (a) => new PostgresStore(sql, a, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
});
after(() => {
  setSqlForTests(null);
  setStoreForTests(null);
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

const user = { login: 'jane', name: 'Jane', avatar: '' };
function call(handler: (ctx: never) => Response | Promise<Response>, body?: unknown, signedIn = true) {
  const url = new URL('https://site.test/api/admin/ai/keys');
  const request = new Request(url, {
    method: body === undefined ? 'GET' : 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return Promise.resolve(handler({ request, url, params: {}, locals: signedIn ? { user } : {} } as never));
}

test('seal → open round trip; another SESSION_SECRET or a tampered value opens as null', async () => {
  const sealed = await sealSecret(KEY, A);
  assert.notEqual(sealed, KEY);
  assert.equal(await openSecret(sealed, A), KEY);
  assert.equal(await openSecret(sealed, 'b'.repeat(32)), null);
  assert.equal(await openSecret(`${sealed.slice(0, -2)}AA`, A), null);
});

test('a stored key wins over the env var; after SESSION_SECRET changes it reads as unset and the env var is used', async () => {
  process.env.OPENAI_API_KEY = 'from-env';
  await setSecret(sql, 'OPENAI_API_KEY', KEY, 'jane');
  assert.equal(await getSecret(sql, 'OPENAI_API_KEY'), KEY);
  const [openai] = await listSecrets(sql);
  assert.deepEqual(openai, { name: 'OPENAI_API_KEY', label: 'OpenAI', source: 'admin', last4: 'abcd' });

  process.env.SESSION_SECRET = 'b'.repeat(32);
  assert.equal(await getSecret(sql, 'OPENAI_API_KEY'), 'from-env');
  assert.deepEqual((await listSecrets(sql))[0], {
    name: 'OPENAI_API_KEY',
    label: 'OpenAI',
    source: 'env',
    undecryptable: true,
  });
  delete process.env.OPENAI_API_KEY;
  assert.equal(await getSecret(sql, 'OPENAI_API_KEY'), undefined);
});

test('env fallback without a database (git mode), and nothing at all when neither is set', async () => {
  assert.equal(await getSecret(null, 'OPENAI_API_KEY'), undefined);
  process.env.OPENAI_API_KEY = 'from-env';
  assert.equal(await getSecret(null, 'OPENAI_API_KEY'), 'from-env');
  const list = await listSecrets(null);
  assert.equal(list.find((s) => s.name === 'OPENAI_API_KEY')?.source, 'env');
  assert.equal(list.find((s) => s.name === 'SERPAPI_KEY')?.source, null);
});

test('a database without migration 003 reads env vars instead of failing', async () => {
  await sql.unsafe('drop table secrets');
  process.env.OPENAI_API_KEY = 'from-env';
  assert.equal(await getSecret(sql, 'OPENAI_API_KEY'), 'from-env');
});

test('keys API: PUT stores, GET lists without ever returning a value, empty clears, unknown names are 400', async () => {
  const put = await call(putKey, { name: 'OPENAI_API_KEY', value: KEY });
  assert.equal(put.status, 200);
  const putText = await put.text();
  assert.ok(!putText.includes(KEY.slice(0, -4)), putText);
  const listed = await (await call(listKeys)).text();
  assert.ok(!listed.includes(KEY.slice(0, -4)), listed);
  assert.match(listed, /"source":"admin","last4":"abcd"/);
  const [row] = await sql<{ value: string; updated_by: string }>`select value, updated_by from secrets`;
  assert.ok(!row.value.includes(KEY), 'stored sealed');
  assert.equal(row.updated_by, 'jane');

  assert.equal((await call(putKey, { name: 'OPENAI_API_KEY', value: '' })).status, 200);
  assert.equal((await sql`select 1 from secrets`).length, 0);
  assert.equal((await call(putKey, { name: 'PATH', value: 'x' })).status, 400);
  assert.equal((await call(putKey, { name: 'OPENAI_API_KEY', value: 5 })).status, 400);
});

test('keys API: needs a session; PUT is refused outside Postgres mode', async () => {
  assert.equal((await call(listKeys, undefined, false)).status, 401);
  assert.equal((await call(putKey, { name: 'OPENAI_API_KEY', value: KEY }, false)).status, 401);
  setStoreForTests(() => new MemoryStore());
  const res = await call(putKey, { name: 'OPENAI_API_KEY', value: KEY });
  assert.equal(res.status, 404);
  assert.equal((await call(listKeys)).status, 200);
});

test('the git backup never sees stored keys, sealed or not', async () => {
  await sql`insert into documents (path, content) values ('config/site.yml', 'title: A')`;
  await setSecret(sql, 'OPENAI_API_KEY', KEY, 'jane');
  const [{ value: sealed }] = await sql<{ value: string }>`select value from secrets`;
  const written: Change[] = [];
  await backupToGit(sql, {
    tree: async () => new Map(),
    createBranch: async () => {},
    commit: async (changes: Change[]) => {
      written.push(...changes);
      return { id: 'c', url: 'https://github.com/o/r/commit/c', versions: {} };
    },
  });
  assert.deepEqual(
    written.map((c) => c.path),
    ['config/site.yml'],
  );
  const text = JSON.stringify(written);
  assert.ok(!text.includes(KEY) && !text.includes(sealed));
});
