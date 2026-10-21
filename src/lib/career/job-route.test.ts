import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { setSqlForTests } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { nonOwnerUser, ownerUser } from './test-owner';
import { PostgresStore } from '../admin/postgres-store';
import { upsertPostings } from './db';
import { GET, PATCH } from '../../admin/routes/api/career/postings/[id]';

const call = (fn: typeof GET, user: ReturnType<typeof ownerUser>, id: string, body?: unknown) =>
  fn({
    locals: { user },
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
  const body = await (await call(GET, ownerUser(), id)).json();
  assert.equal(body.posting.description, EVIL);
  assert.deepEqual(body.events, []);
});

test('PATCH status records an event', async () => {
  const res = await call(PATCH, ownerUser(), id, { status: 'skipped' });
  assert.equal(res.status, 200);
  const body = await (await call(GET, ownerUser(), id)).json();
  assert.equal(body.posting.status, 'skipped');
  assert.deepEqual(
    body.events.map((e: { kind: string; detail: string }) => [e.kind, e.detail]),
    [['status', 'found → skipped']],
  );
});

test('PATCH notes records an event; a no-op records none', async () => {
  await call(PATCH, ownerUser(), id, { notes: 'hi' });
  await call(PATCH, ownerUser(), id, { notes: 'hi', status: 'found' });
  const body = await (await call(GET, ownerUser(), id)).json();
  assert.equal(body.posting.notes, 'hi');
  assert.deepEqual(
    body.events.map((e: { kind: string }) => e.kind),
    ['notes edited'],
  );
});

test('PATCH rejects an unknown status, unknown keys and long notes with 400', async () => {
  assert.equal((await call(PATCH, ownerUser(), id, { status: 'bogus' })).status, 400);
  assert.equal((await call(PATCH, ownerUser(), id, { nope: 1 })).status, 400);
  assert.equal((await call(PATCH, ownerUser(), id, { notes: 'x'.repeat(20_001) })).status, 400);
});

test('a non-owner gets 404, and so does a bad or missing id', async () => {
  assert.equal((await call(GET, nonOwnerUser(), id)).status, 404);
  assert.equal((await call(PATCH, nonOwnerUser(), id, { status: 'skipped' })).status, 404);
  assert.equal((await call(GET, ownerUser(), '999999')).status, 404);
  assert.equal((await call(GET, ownerUser(), 'abc')).status, 404);
});

test('PATCH cv refuses a skills line that adds an item, with the reason', async () => {
  await sql`insert into documents (path, content) values ('config/cv.yml', ${'cv:\n  name: J\n  sections:\n    skills:\n      - label: Languages\n        details: Python, SQL\n'})`;
  const cv = (details: string) => ({ sections: [{ title: 'skills', entries: [{ ref: 0, details }] }] });
  assert.equal((await call(PATCH, ownerUser(), id, { cv: cv('SQL, Python') })).status, 200);
  const res = await call(PATCH, ownerUser(), id, { cv: cv('SQL, Rust') });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'skills entry 0 adds "Rust"');
});
