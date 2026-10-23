import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { upsertPapers } from './db';
import { addChat, setChatSaved } from './room-db';
import {
  backlinks,
  createNote,
  deleteNote,
  freeTitle,
  getNote,
  graph,
  listNotes,
  renameNote,
  setBody,
  withTitles,
} from './vault-db';
import type { VaultNote } from './types';

let sql: Sql;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});

const make = async (title: string, body = ''): Promise<VaultNote> => {
  const n = await createNote(sql, title);
  assert.notEqual(n, 'taken');
  const note = n as VaultNote;
  if (body) await setBody(sql, note.id, body);
  return note;
};
const links = async (id: number) =>
  (await sql<{ target: string }>`select target from vault_links where from_id = ${id} order by target`).map(
    (r) => r.target,
  );
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

test('freeTitle numbers a taken title', async () => {
  await make('Same');
  assert.equal(await withTitles(sql, (tx) => freeTitle(tx, 'Same')), 'Same (2)');
  await make('same (2)');
  assert.equal(await withTitles(sql, (tx) => freeTitle(tx, 'Same')), 'Same (3)');
  assert.equal(await withTitles(sql, (tx) => freeTitle(tx, 'Fresh: one')), 'Fresh one');
});

test('freeTitle ignores the note itself', async () => {
  const a = await make('Same');
  assert.equal(await withTitles(sql, (tx) => freeTitle(tx, 'same', a.id)), 'same');
});

test('freeTitle keeps a numbered emoji title inside the cap', async () => {
  const long = '😀'.repeat(60); // 60 code points, 240 bytes: noteTitle cuts it to 50
  const first = await make(long);
  assert.equal([...first.title].length, 50);
  const t = await withTitles(sql, (tx) => freeTitle(tx, long));
  assert.equal(t, `${'😀'.repeat(46)} (2)`);
});

test('createNote refuses a title taken in another case', async () => {
  const a = await make('Attention: Is All You Need?');
  assert.equal(a.title, 'Attention Is All You Need');
  assert.equal(a.kind, 'free');
  assert.equal(a.body, '');
  assert.equal(await createNote(sql, 'attention is all you need'), 'taken');
  assert.deepEqual(await getNote(sql, a.id), a);
  assert.equal(await getNote(sql, a.id + 99), null);
});

test("setBody keeps the note's links", async () => {
  const a = await make('Note');
  assert.equal(await setBody(sql, a.id, '[[A]] [[a]] [[B]]'), true);
  assert.deepEqual(await links(a.id), ['a', 'b']);
  assert.equal(await setBody(sql, a.id, '[[B]] [[ C  d ]]'), true);
  assert.deepEqual(await links(a.id), ['b', 'c d']);
  assert.equal((await getNote(sql, a.id))!.body, '[[B]] [[ C  d ]]');
  assert.equal(await setBody(sql, a.id + 99, '[[X]]'), false);
});

test('renaming a note rewrites the links to it', async () => {
  const old = await make('Old');
  const c = await make('C', 'see [[Old|o]] and ![[old#Method]]');
  const d = await make('D', 'see [[Old notes]]');
  const r = await renameNote(sql, old.id, 'New');
  assert.equal((r as VaultNote).title, 'New');
  assert.equal((await getNote(sql, c.id))!.body, 'see [[New|o]] and ![[New#Method]]');
  assert.equal((await getNote(sql, d.id))!.body, 'see [[Old notes]]');
  assert.deepEqual(titles(await backlinks(sql, old.id)), ['C']);
  assert.deepEqual(await links(c.id), ['new']);
  assert.equal(await renameNote(sql, old.id + 99, 'X'), null);
});

test("a rename onto another note's title is refused", async () => {
  const a = await make('A');
  await make('B');
  assert.equal(await renameNote(sql, a.id, 'b'), 'taken');
  assert.equal((await getNote(sql, a.id))!.title, 'A');
  assert.equal(((await renameNote(sql, a.id, 'a')) as VaultNote).title, 'a'); // its own title, another case
});

test('a link to a missing note resolves once the note exists', async () => {
  const a = await make('A', 'to [[Later]]');
  assert.deepEqual(await backlinks(sql, a.id), []);
  const later = await make('later');
  assert.deepEqual(titles(await backlinks(sql, later.id)), ['A']);
});

test('backlinks leave out the note itself and list by title', async () => {
  const t = await make('T', '[[T]]');
  await make('b', '[[T]]');
  await make('A', '[[t]]');
  assert.deepEqual(titles(await backlinks(sql, t.id)), ['A', 'b']);
});

test('deleting a chat note unsaves its answer', async () => {
  const [paper] = (
    await upsertPapers(sql, [
      { key: 'arxiv:1', arxiv: '1', source: 'arxiv', title: 'P', authors: [], url: 'https://x.test/1', categories: [] },
    ])
  ).map((r) => r.id);
  const answer = await addChat(sql, { paper }, { role: 'assistant', body: 'yes', cites: [] });
  await setChatSaved(sql, answer.id, true);
  const chat = { question: 'Q?', answer: 'yes', cites: [], askedAt: answer.createdAt };
  const [{ id }] = await sql<{ id: number }>`
    insert into vault_notes (kind, title, chat, chat_id) values ('chat', 'Q', ${JSON.stringify(chat)}::text::jsonb,
      ${answer.id}) returning id`;
  assert.deepEqual((await getNote(sql, Number(id)))!.chat, chat);
  assert.equal(await deleteNote(sql, Number(id)), true);
  assert.equal(await getNote(sql, Number(id)), null);
  const [r] = await sql`select saved_at from reading_chats where id = ${answer.id}`;
  assert.equal(r.saved_at, null);
  assert.equal(await deleteNote(sql, Number(id)), false);
});

test('listNotes searches titles first, then bodies', async () => {
  await make('Zebra', 'about apples');
  await make('Plain', 'nothing');
  await make('Apple pie');
  await make('100% sure', 'a_b');
  assert.deepEqual(titles(await listNotes(sql, { q: 'apple' })), ['Apple pie', 'Zebra']);
  assert.deepEqual(titles(await listNotes(sql, { q: '%' })), ['100% sure']);
  assert.deepEqual(titles(await listNotes(sql, { q: '_' })), ['100% sure']);
  assert.equal((await listNotes(sql)).length, 4);
  assert.deepEqual(await listNotes(sql, { kind: 'paper' }), []);
  assert.deepEqual(titles(await listNotes(sql, { kind: 'free', q: 'plain' })), ['Plain']);
});

test('graph keeps the most-linked notes', async () => {
  const a = await make('A', '[[B]] [[C]] [[A]]');
  const b = await make('B', '[[A]] [[C]]');
  const c = await make('C', '[[D]]');
  const d = await make('D');
  await make('E', '[[Missing]]');
  const g = await graph(sql, 3);
  assert.equal(g.total, 5);
  // links in and out: A 3, B 3, C 3, D 1, E 0
  assert.deepEqual(
    g.nodes.map((n) => [n.title, n.links]),
    [
      ['C', 3],
      ['B', 3],
      ['A', 3],
    ],
  );
  const pairs = g.edges.map(([x, y]) => [x, y].sort((p, q) => p - q).join('-')).sort();
  assert.deepEqual(pairs, [`${a.id}-${b.id}`, `${a.id}-${c.id}`, `${b.id}-${c.id}`].sort());
  assert.equal(g.edges.length, 3); // A↔B once, no A→A, nothing to D
  assert.ok(!g.edges.flat().includes(d.id));
});
