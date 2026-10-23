import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { upsertPapers } from './db';
import { HttpError } from '../admin/http';
import {
  addChat,
  addHighlight,
  claimOutput,
  createNotebook,
  savePassages,
  setChatSaved,
  setOutput,
  updateNotebook,
} from './room-db';
import { lockProbe } from './test-locks';
import { unzip } from './test-unzip';
import {
  backlinks,
  createNote,
  deleteNote,
  ensureChatNote,
  ensurePaperNote,
  exportVault,
  noteContexts,
  freeTitle,
  getNote,
  graph,
  listNotes,
  renameNote,
  saveRoomNote,
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

test('a rename row-locks the notes it rewrites before writing them, so a save landing meanwhile waits', async () => {
  const old = await make('Old');
  const c = await make('C', 'see [[Old]]');
  const d = await make('D', '[[old]] too');
  await make('E', 'unrelated');
  const p = lockProbe(sql);
  await renameNote(p.sql, old.id, 'New');
  assert.deepEqual(p.writes[0], { titleLock: true, locked: [c.id, d.id] });
});

test('a rename that would push a linking note past 20,000 characters is refused and changes nothing', async () => {
  const old = await make('Old');
  const full = `${'x'.repeat(20_000 - 7)}[[Old]]`;
  const c = await make('C', full);
  await assert.rejects(
    renameNote(sql, old.id, 'Longer'),
    (e) =>
      e instanceof HttpError && e.status === 400 && e.message === 'That would make “C” longer than 20,000 characters.',
  );
  assert.equal((await getNote(sql, old.id))!.title, 'Old');
  assert.equal((await getNote(sql, c.id))!.body, full);
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
  const chat = { question: 'Q?', answer: 'yes', cites: [], askedAt: answer.createdAt, origin: 'paper' };
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

const paper = async (n: number, title: string, abstract?: string) =>
  (
    await upsertPapers(sql, [
      {
        key: `arxiv:${n}`,
        arxiv: String(n),
        source: 'arxiv',
        title,
        authors: [`Ann Author${n}`],
        abstract,
        url: `https://x.test/${n}`,
        categories: [],
      },
    ])
  )[0].id;
const paperNote = (id: number) => withTitles(sql, (tx) => ensurePaperNote(tx, id));
const readyOutput = async (target: { paper: number } | { notebook: number }, text: string, papers: number[]) => {
  const id = (await claimOutput(sql, target, 'summary', null, 'run'))!;
  await setOutput(sql, id, {
    status: 'ready',
    body: { papers, sections: [{ heading: 'Summary', claims: [{ text, cites: [] }] }] },
  });
};

test("noteContexts gathers each note's paper, summary, highlights, cited authors and notebook", async () => {
  const a = await paper(1, 'A');
  const b = await paper(2, 'B');
  const pa = await paperNote(a);
  const pb = await paperNote(b);
  await readyOutput({ paper: a }, 'A says.', [a]);
  await claimOutput(sql, { paper: b }, 'summary', null, 'run'); // running: not ready
  await addHighlight(sql, { paperId: a, pid: 'S1.p1', start: 0, end: 5, quote: 'quote', comment: 'c' });
  const nb = await createNotebook(sql, 'Book');
  await updateNotebook(sql, nb, { add: a });
  await addChat(sql, { notebook: nb }, { role: 'user', body: 'Q?', cites: [] });
  const nbAns = await addChat(
    sql,
    { notebook: nb },
    { role: 'assistant', body: 'Yes [2:p1].', cites: [{ paper: b, pid: 'p1' }] },
  );
  await addChat(sql, { paper: a }, { role: 'user', body: 'R?', cites: [] });
  const pAns = await addChat(
    sql,
    { paper: a },
    { role: 'assistant', body: 'No [1:p1].', cites: [{ paper: a, pid: 'p1' }] },
  );
  const nc = await withTitles(sql, (tx) => ensureChatNote(tx, nbAns.id));
  const pc = await withTitles(sql, (tx) => ensureChatNote(tx, pAns.id));
  const { id: free } = await withTitles(sql, (tx) => saveRoomNote(tx, { notebook: nb }, 'nb'));

  const notes = await Promise.all([pa.id, pb.id, nc.id, pc.id, free!].map((id) => getNote(sql, id)));
  const ctx = await noteContexts(sql, notes as VaultNote[]);
  assert.equal(ctx.get(pa.id)!.paper!.title, 'A');
  assert.equal(ctx.get(pa.id)!.summary!.sections[0].claims[0].text, 'A says.');
  assert.deepEqual(ctx.get(pa.id)!.highlights, [{ pid: 'S1.p1', quote: 'quote', comment: 'c' }]);
  assert.equal(ctx.get(pb.id)!.summary, null);
  assert.deepEqual(ctx.get(pb.id)!.highlights, []);
  assert.deepEqual([...ctx.get(nc.id)!.authors], [[b, { authors: ['Ann Author2'] }]]);
  assert.equal(ctx.get(pc.id)!.authors.size, 0, "a paper's chat cites without surnames");
  assert.equal(ctx.get(free!)!.notebook, 'Book');
  assert.deepEqual(await noteContexts(sql, []), new Map());
});

test('a title with a colon exports as the file its links name', async () => {
  await paperNote(await paper(1, 'Attention: Is All?'));
  const idea = await make('Idea', 'see [[Attention Is All]]');
  const files = unzip(await exportVault(sql));
  assert.deepEqual(files.map((f) => f.path).sort(), ['vault/notes/Idea.md', 'vault/papers/Attention Is All.md']);
  assert.match(files.find((f) => f.path === 'vault/notes/Idea.md')!.text, /\[\[Attention Is All\]\]$/);
  assert.deepEqual(titles(await backlinks(sql, (await listNotes(sql, { kind: 'paper' }))[0].id)), [idea.title]);
});

test('the export holds no paper text', async () => {
  const id = await paper(1, 'P', 'Abstract FULL TEXT SENTINEL');
  await savePassages(sql, id, [
    { pid: 'abs.1', kind: 'p', body: 'Abstract FULL TEXT SENTINEL' },
    { pid: 'S1.p1', kind: 'p', body: 'Body FULL TEXT SENTINEL with a short quote in it.' },
  ]);
  await addHighlight(sql, { paperId: id, pid: 'S1.p1', start: 36, end: 47, quote: 'short quote', comment: '' });
  await readyOutput({ paper: id }, 'It finds things.', [id]);
  await paperNote(id);
  await addChat(sql, { paper: id }, { role: 'user', body: 'Q?', cites: [] });
  const ans = await addChat(
    sql,
    { paper: id },
    { role: 'assistant', body: 'A [1:S1.p1].', cites: [{ paper: id, pid: 'S1.p1' }] },
  );
  await withTitles(sql, (tx) => ensureChatNote(tx, ans.id));
  const files = unzip(await exportVault(sql));
  assert.equal(files.length, 2);
  for (const f of files) assert.ok(!f.text.includes('SENTINEL'), f.path);
  const p = files.find((f) => f.path === 'vault/papers/P.md')!;
  assert.match(p.text, /“short quote” \(§1 ¶1\)/);
  assert.match(p.text, /It finds things\. \(background\)/);
});

test('an export over the limit is refused', async () => {
  await make('A', 'x');
  await assert.rejects(exportVault(sql, 10), (e) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 413);
    assert.equal(e.message, 'The vault’s zip is 0.1 MB, over the 4.4 MB one download can carry.');
    return true;
  });
  assert.ok((await exportVault(sql)).byteLength > 10);
});
