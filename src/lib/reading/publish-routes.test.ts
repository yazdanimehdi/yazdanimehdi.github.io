import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { setSqlForTests, type Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { MemoryStore } from '../admin/memory-store';
import { PostgresStore } from '../admin/postgres-store';
import { nonOwnerUser, ownerUser } from '../career/test-owner';
import { upsertPapers } from './db';
import { republish } from './publish-db';
import { addHighlight, listHighlights } from './room-db';
import type { VaultNote } from './types';
import { createNote, getNote } from './vault-db';
import { setRepublishForTests } from './visibility';
import * as vNote from '../../admin/routes/api/reading/vault/notes/[id]';
import * as highlight from '../../admin/routes/api/reading/highlights/[id]';
import * as notes from '../../admin/routes/api/reading/notes';
import * as papers from '../../admin/routes/api/reading/papers/[id]';
import * as publish from '../../admin/routes/api/reading/vault/publish';

type Handler = (ctx: never) => Response | Promise<Response>;

let sql: Sql;
const deps = { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} };
const siteYml = (yml: string) =>
  sql`insert into documents (path, content) values ('config/site.yml', ${yml})
    on conflict (path) do update set content = excluded.content`;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  await siteYml('pages:\n  readings: true\n  notes: true\n');
  setSqlForTests(sql);
  setStoreForTests((author) => new PostgresStore(sql, author));
  setRepublishForTests((s) => republish(s, deps));
});
after(() => {
  setStoreForTests(null);
  setSqlForTests(null);
  setRepublishForTests(null);
});

const call = (handler: Handler, o: { body?: unknown; params?: Record<string, string>; owner?: boolean } = {}) =>
  handler({
    locals: { user: o.owner === false ? nonOwnerUser() : ownerUser() },
    url: new URL('http://x/api/admin/reading'),
    params: o.params ?? {},
    request: new Request('http://x/', {
      method: o.body === undefined ? 'GET' : 'POST',
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    }),
  } as never) as Promise<Response>;
const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, await res.clone().text());
  return status === 204 ? null : res.json();
};
const doc = async (path: string): Promise<string | null> =>
  (await sql<{ content: string }>`select content from documents where path = ${path}`)[0]?.content ?? null;
const failing = () => {
  setRepublishForTests(async () => {
    throw new Error('the database went away');
  });
  return mock.method(console, 'error', () => {});
};
const WARNING = 'Your public pages weren’t updated: the database went away';
const free = async (title: string) => (await createNote(sql, title)) as VaultNote;
const patchNote = (id: number, body: unknown) => call(vNote.PATCH, { params: { id: String(id) }, body });
const addPaper = async () =>
  (
    await upsertPapers(sql, [
      { key: 'arxiv:1', source: 'arxiv', title: 'Deep Folds', authors: ['A'], url: 'https://x.test/1', categories: [] },
    ])
  )[0].id;

test('making a note public answers its address and writes the copy; private deletes it', async () => {
  const n = await free('My Note');
  const { note, visibility } = await ok(await patchNote(n.id, { public: true, body: 'hello' }));
  assert.equal(note.public, true);
  assert.deepEqual(visibility, { noteId: n.id, public: true, url: '/notes/my-note/', pageOn: true, chat: false });
  assert.match((await doc('src/content/notes/my-note.md'))!, /hello$/);
  assert.deepEqual((await ok(await call(vNote.GET, { params: { id: String(n.id) } }))).visibility, visibility);

  await ok(await patchNote(n.id, { body: 'hello again' }));
  assert.match((await doc('src/content/notes/my-note.md'))!, /hello again$/, 'a body save updates the copy');

  const off = await ok(await patchNote(n.id, { public: false }));
  assert.deepEqual(off.visibility, { noteId: n.id, public: false, url: null, pageOn: true, chat: false });
  assert.equal(await doc('src/content/notes/my-note.md'), null);
});

const SNAPSHOT = { question: 'Why?', answer: 'Because.', cites: [], askedAt: '2026-10-23T00:00:00Z', origin: 'paper' };
test('a chat note cannot be made public', async () => {
  const [{ id }] = await sql<{ id: number }>`
    insert into vault_notes (kind, title, chat) values ('chat', 'Why?', ${JSON.stringify(SNAPSHOT)}::jsonb) returning id`;
  const res = await patchNote(Number(id), { public: true, body: 'mine' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "Chat notes can't be made public: they are mostly AI text.");
  assert.equal((await getNote(sql, Number(id)))!.body, '', 'a body sent with the refused toggle is not saved');
  const { visibility } = await ok(await call(vNote.GET, { params: { id: String(id) } }));
  assert.equal(visibility.chat, true);
});

test('a paper shares at most 10 highlights', async () => {
  const paperId = await addPaper();
  const hs = [];
  for (let i = 0; i < 11; i++)
    hs.push(await addHighlight(sql, { paperId, pid: 'p1', start: i, end: i + 1, quote: 'q', comment: '' }));
  const patch = (id: number, body: unknown) => call(highlight.PATCH, { params: { id: String(id) }, body });
  for (const h of hs.slice(0, 10)) assert.deepEqual(await ok(await patch(h.id, { public: true })), { public: true });
  const res = await patch(hs[10].id, { public: true, comment: 'mine' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'A paper shares at most 10 highlights.');
  assert.equal((await listHighlights(sql, [paperId]))[10].comment, '', 'a refused toggle writes nothing');
  assert.deepEqual(await ok(await patch(hs[10].id, { comment: 'mine' })), { comment: 'mine' });
  assert.equal((await patch(hs[10].id, {})).status, 400);
  assert.equal((await patch(999, { public: true })).status, 404);
});

test('a failed republish never fails the save', async () => {
  const n = await free('My Note');
  const err = failing();
  const res = await ok(await patchNote(n.id, { body: 'kept' }));
  assert.equal(res.publishWarning, WARNING);
  assert.equal((await getNote(sql, n.id))!.body, 'kept');
  assert.equal(err.mock.callCount(), 1);
  assert.match(String(err.mock.calls[0].arguments[0]), /^\[reading\]/);

  const paperId = await addPaper();
  assert.equal((await ok(await call(notes.PUT, { body: { paper: paperId, body: 'x' } }))).publishWarning, WARNING);
  const del = await call(vNote.DELETE, { params: { id: String(n.id) } });
  assert.deepEqual(await ok(del), { publishWarning: WARNING });
  const h = await addHighlight(sql, { paperId, pid: 'p1', start: 0, end: 1, quote: 'q', comment: '' });
  assert.deepEqual(await ok(await call(highlight.DELETE, { params: { id: String(h.id) } })), {
    publishWarning: WARNING,
  });

  const again = await call(publish.POST, { body: {} });
  assert.equal(again.status, 502);
  assert.equal((await again.json()).error, WARNING);
  err.mock.restore();
});

test('a failed cache purge keeps the save and the copy, with a warning', async () => {
  const err = mock.method(console, 'error', () => {});
  setRepublishForTests((s) => republish(s, { ...deps, purge: async () => Promise.reject(new Error('purge down')) }));
  const STALE = 'Your public pages were saved but the cache didn’t refresh. Publish again to retry.';
  const n = await free('My Note');
  const res = await ok(await patchNote(n.id, { public: true, body: 'hello' }));
  assert.equal(res.publishWarning, STALE);
  assert.match((await doc('src/content/notes/my-note.md'))!, /hello$/);
  await sql`delete from documents`;
  assert.deepEqual(await ok(await call(publish.POST, { body: {} })), { changed: 1, publishWarning: STALE });
  err.mock.restore();
});

test('deleting a note answers 204 when publishing works', async () => {
  const n = await free('My Note');
  await ok(await patchNote(n.id, { public: true }));
  await ok(await call(vNote.DELETE, { params: { id: String(n.id) } }), 204);
  assert.equal(await doc('src/content/notes/my-note.md'), null);
});

test('publishing a paper from the room creates its note; Publish again reruns republish', async () => {
  const paperId = await addPaper();
  await addHighlight(sql, { paperId, pid: 'p1', start: 0, end: 1, quote: 'q', comment: '' });
  const room = await ok(await call(papers.GET, { params: { id: String(paperId) } }));
  assert.deepEqual(room.visibility, {
    noteId: null,
    public: false,
    url: null,
    pageOn: true,
    chat: false,
    highlights: { on: 0, all: 1 },
  });
  assert.equal(room.highlights[0].public, false);

  const off = await ok(await call(publish.POST, { body: { paper: paperId, public: false } }));
  assert.equal(off.visibility.noteId, null, 'making a paper without a note private creates none');
  assert.equal((await sql`select 1 from vault_notes`).length, 0);

  const { visibility } = await ok(await call(publish.POST, { body: { paper: paperId, public: true } }));
  const note = (await getNote(sql, visibility.noteId))!;
  assert.equal(note.kind, 'paper');
  assert.equal(note.paperId, paperId);
  assert.deepEqual(visibility, {
    noteId: note.id,
    public: true,
    url: `/readings/${note.publicSlug}/`,
    pageOn: true,
    chat: false,
    highlights: { on: 0, all: 1 },
  });
  assert.ok(await doc(`src/content/readings/${note.publicSlug}.md`));
  assert.deepEqual((await ok(await call(papers.GET, { params: { id: String(paperId) } }))).visibility, visibility);

  assert.deepEqual(await ok(await call(publish.POST, { body: {} })), { changed: 0 });
  await sql`delete from documents`;
  assert.deepEqual(await ok(await call(publish.POST, { body: {} })), { changed: 1 });
  for (const body of [{ paper: paperId }, { public: true }])
    assert.equal((await call(publish.POST, { body })).status, 400, JSON.stringify(body));
  assert.equal((await call(publish.POST, { body: { paper: 999, public: true } })).status, 404);
});

test('the Visibility line says the page is off while site.yml leaves it off', async () => {
  const n = await free('My Note');
  const pageOn = async () => (await ok(await call(vNote.GET, { params: { id: String(n.id) } }))).visibility.pageOn;
  await siteYml('pages:\n  notes: false\n');
  assert.equal(await pageOn(), false);
  await siteYml('title: A\n');
  assert.equal(await pageOn(), false, 'no setting means off');
  await siteYml('pages:\n  notes: true\n');
  assert.equal(await pageOn(), true);
});

test('Publish again is the owner’s, in Postgres mode', async () => {
  const res = await call(publish.POST, { body: {}, owner: false });
  assert.equal(res.status, 404);
  setStoreForTests(() => new MemoryStore());
  assert.equal((await call(publish.POST, { body: {} })).status, 404);
});

test('the visibility routes answer in Postgres mode, where admin routes run outside a request context', async (t) => {
  // getMode() is static in the other tests, so site.yml came from disk and the missing request context never showed.
  const env = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
  Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://unused.test/db' });
  t.after(() => {
    for (const [k, v] of Object.entries(env))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  const n = await free('Plain');
  const paperId = await addPaper();
  const got = await ok(await call(vNote.GET, { params: { id: String(n.id) } }));
  assert.equal(got.visibility.pageOn, true);
  assert.equal((await ok(await patchNote(n.id, { public: true }))).visibility.url, '/notes/plain/');
  assert.equal((await ok(await call(papers.GET, { params: { id: String(paperId) } }))).visibility.noteId, null);
  assert.equal(
    (await ok(await call(publish.POST, { body: { paper: paperId, public: true } }))).visibility.public,
    true,
  );
});
