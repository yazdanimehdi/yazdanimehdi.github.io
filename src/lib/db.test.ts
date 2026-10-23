import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnreachable } from './db';
import { migrate } from './db-migrate';
import { pgliteSql } from './pglite-sql';

test('migrate creates the tables once; a second run applies nothing', async () => {
  const sql = pgliteSql();
  assert.deepEqual(await migrate(sql), [
    '001_init.sql',
    '002_admin_users.sql',
    '003_secrets.sql',
    '004_login_attempts_ip.sql',
    '005_career.sql',
    '006_apply.sql',
    '007_apply_lock.sql',
    '008_reading.sql',
    '009_reading_room.sql',
    '010_vault.sql',
    '011_public_notes.sql',
  ]);
  assert.deepEqual(await migrate(sql), []);
  await sql`insert into documents (path, content) values ('config/site.yml', 'title: A')`;
  const [row] = await sql<{ version: number; updated_by: string | null }>`select version, updated_by from documents`;
  assert.equal(row.version, 1);
  assert.equal(row.updated_by, null);
  const tables = await sql<{
    name: string;
  }>`select table_name as name from information_schema.tables where table_schema = 'public' order by 1`;
  assert.deepEqual(
    tables.map((t) => t.name),
    [
      'admin_users',
      'career_events',
      'career_postings',
      'career_settings',
      'documents',
      'login_attempts',
      'media',
      'reading_ai_use',
      'reading_chats',
      'reading_digest',
      'reading_highlights',
      'reading_notebook_papers',
      'reading_notebooks',
      'reading_outputs',
      'reading_papers',
      'reading_passages',
      'reading_settings',
      'reading_texts',
      'revisions',
      'schema_migrations',
      'secrets',
      'vault_links',
      'vault_notes',
      'vault_suggestions',
    ],
  );
});

test('begin rolls everything back when the callback throws', async () => {
  const sql = pgliteSql();
  await migrate(sql);
  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`insert into documents (path, content) values ('a', 'x')`;
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal((await sql`select * from documents`).length, 0);
});

test('isUnreachable: connection errors yes, query errors no', () => {
  assert.equal(isUnreachable(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true);
  assert.equal(isUnreachable(Object.assign(new Error('x'), { code: 'CONNECT_TIMEOUT' })), true);
  assert.equal(isUnreachable(Object.assign(new Error('x'), { code: '42P01' })), false);
  assert.equal(isUnreachable('nope'), false);
});

test('pgliteSql: array params, and a transaction handle without begin, as in postgres.js 3.4.9', async () => {
  const sql = pgliteSql();
  await migrate(sql);
  await sql`insert into documents (path, content) values ('a', '1'), ('b', '2'), ('c', '3')`;
  const rows = await sql<{
    path: string;
  }>`select path from documents where path = any(${['a', 'c']}::text[]) order by 1`;
  assert.deepEqual(
    rows.map((r) => r.path),
    ['a', 'c'],
  );
  await sql.begin(async (tx) => {
    assert.equal('begin' in tx, false);
    await tx`delete from documents where path = ${'a'}`;
  });
  assert.equal((await sql`select * from documents`).length, 2);
});
