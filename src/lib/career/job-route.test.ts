import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { setSqlForTests } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { adminLogin, adminSettings } from '../admin/settings';
import { PostgresStore } from '../admin/postgres-store';
import { upsertPostings } from './db';
import { GET, PATCH } from '../../admin/routes/api/career/postings/[id]';

const owner = adminLogin(adminSettings().owner);
const user = (login: string) => ({ login, name: login, avatar: '', provider: 'github' });
const call = (fn: typeof GET, login: string, id: string, body?: unknown) =>
  fn({
    locals: { user: user(login) },
    params: { id },
    request: new Request('http://x/', { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
    url: new URL('http://x/'),
  } as never) as Promise<Response>;
const flags = {
  hiddenBlocks: [],
  hiddenUrls: [],
  invisible: { zero_width: 0, bidi: 0, format: 0, bom: 0 },
  invisibleFlagged: 0,
  instructionLines: [],
  mixedScript: [],
  warn: false,
};
const EVIL = '<script>alert(1)</script>';

let sql: ReturnType<typeof pgliteSql>;
let id: string;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests((author) => new PostgresStore(sql, author));
  await upsertPostings(sql, [
    {
      source: 's',
      externalId: '1',
      company: 'Acme',
      title: 'Dev',
      url: 'https://a.test',
      description: EVIL,
      format: 'text',
      key: 'k1',
      text: EVIL,
      flags,
    },
  ]);
  id = String((await sql<{ id: number }>`select id from career_postings`)[0].id);
});
after(() => {
  setStoreForTests(null);
  setSqlForTests(null);
});

test('GET returns the posting and events; text comes back verbatim', async () => {
  const body = await (await call(GET, owner, id)).json();
  assert.equal(body.posting.description, EVIL);
  assert.deepEqual(body.events, []);
});

test('PATCH status records an event', async () => {
  const res = await call(PATCH, owner, id, { status: 'skipped' });
  assert.equal(res.status, 200);
  const body = await (await call(GET, owner, id)).json();
  assert.equal(body.posting.status, 'skipped');
  assert.deepEqual(
    body.events.map((e: { kind: string; detail: string }) => [e.kind, e.detail]),
    [['status', 'found → skipped']],
  );
});

test('PATCH notes records an event; a no-op records none', async () => {
  await call(PATCH, owner, id, { notes: 'hi' });
  await call(PATCH, owner, id, { notes: 'hi', status: 'found' });
  const body = await (await call(GET, owner, id)).json();
  assert.equal(body.posting.notes, 'hi');
  assert.deepEqual(
    body.events.map((e: { kind: string }) => e.kind),
    ['notes edited'],
  );
});

test('PATCH rejects an unknown status, unknown keys and long notes with 400', async () => {
  assert.equal((await call(PATCH, owner, id, { status: 'bogus' })).status, 400);
  assert.equal((await call(PATCH, owner, id, { nope: 1 })).status, 400);
  assert.equal((await call(PATCH, owner, id, { notes: 'x'.repeat(20_001) })).status, 400);
});

test('a non-owner gets 404, and so does a bad or missing id', async () => {
  assert.equal((await call(GET, `${owner}-other`, id)).status, 404);
  assert.equal((await call(PATCH, `${owner}-other`, id, { status: 'skipped' })).status, 404);
  assert.equal((await call(GET, owner, '999999')).status, 404);
  assert.equal((await call(GET, owner, 'abc')).status, 404);
});
