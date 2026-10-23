import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { HttpError } from '../admin/http';
import { PostgresStore } from '../admin/postgres-store';
import type { Sql } from '../db';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { draftNotes, draftSources, voiceExamples } from './blog-draft';
import { upsertPapers } from './db';
import { addChat, addHighlight, claimOutput, createNotebook, setOutput, updateNotebook } from './room-db';
import { createNote, ensureChatNote, ensurePaperNote, saveRoomNote, setBody, withTitles } from './vault-db';

let sql: Sql;
let store: PostgresStore;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  store = new PostgresStore(
    sql,
    { name: 'Owner', email: 'owner@x.test' },
    { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} },
  );
});
afterEach(() => mock.restoreAll());

const paper = async (k: string) =>
  (
    await upsertPapers(sql, [
      {
        key: `arxiv:${k}`,
        arxiv: k,
        source: 'arxiv',
        title: `Paper ${k}`,
        authors: [`Ann ${k}`],
        url: `https://x.test/${k}`,
        categories: [],
      },
    ])
  )[0].id;
const paperNote = async (id: number, body = '') => {
  const n = await withTitles(sql, (tx) => ensurePaperNote(tx, id));
  if (body) await setBody(sql, n.id, body);
  return n.id;
};
const freeNote = async (title: string, body = '') => {
  const n = await createNote(sql, title);
  assert.notEqual(n, 'taken');
  const id = (n as { id: number }).id;
  if (body) await setBody(sql, id, body);
  return id;
};
/** A saved answer's chat note. */
const chatNote = async (target: { paper: number } | { notebook: number }, answer: string, cited: number[]) => {
  await addChat(sql, target, { role: 'user', body: `Q about ${answer}?`, cites: [] });
  const a = await addChat(sql, target, {
    role: 'assistant',
    body: answer,
    cites: cited.map((paper) => ({ paper, pid: 'p1' })),
  });
  return (await withTitles(sql, (tx) => ensureChatNote(tx, a.id))).id;
};
const refused = (status: number, message: string | RegExp) => (e: unknown) =>
  e instanceof HttpError &&
  e.status === status &&
  (typeof message === 'string' ? e.message === message : message.test(e.message));

test('sources come from a paper, a notebook, a note or a selection', async () => {
  const a = await paper('A');
  const b = await paper('B');
  await paperNote(a);
  const nb = await createNotebook(sql, 'Book');
  await updateNotebook(sql, nb, { add: a });
  await updateNotebook(sql, nb, { add: b });
  const { id: nbNote } = await withTitles(sql, (tx) => saveRoomNote(tx, { notebook: nb }, 'my thoughts'));

  assert.deepEqual(await draftSources(sql, { paper: a }), { paperIds: [a], noteIds: [] });
  assert.deepEqual(await draftSources(sql, { notebook: nb }), { paperIds: [a, b], noteIds: [nbNote] });
  const free = await freeNote('Idea', 'see [[paper a]] and [[Nothing]]');
  assert.deepEqual(await draftSources(sql, { note: free }), { paperIds: [a], noteIds: [free] });
  const chat = await chatNote({ notebook: nb }, 'B says so.', [b]);
  assert.deepEqual(await draftSources(sql, { note: chat }), { paperIds: [b], noteIds: [chat] });
  const pChat = await chatNote({ paper: a }, 'A says so.', []);
  assert.deepEqual(await draftSources(sql, { note: pChat }), { paperIds: [a], noteIds: [pChat] });
  assert.deepEqual(await draftSources(sql, { papers: [b, a, b] }), { paperIds: [b, a], noteIds: [] });
  const pn = await paperNote(b);
  assert.deepEqual(await draftSources(sql, { note: pn }), { paperIds: [b], noteIds: [pn] });
  // A notebook's own note: the notebook's papers, then its links.
  const c = await paper('C');
  await paperNote(c);
  await setBody(sql, nbNote!, 'and [[Paper C]], [[Paper A]]');
  assert.deepEqual(await draftSources(sql, { note: nbNote! }), { paperIds: [a, b, c], noteIds: [nbNote] });
});

test("sources refuse what can't be drafted", async () => {
  const empty = await createNotebook(sql, 'Empty');
  await assert.rejects(draftSources(sql, { notebook: empty }), refused(409, 'This notebook has no papers yet.'));
  const blank = await freeNote('Blank', '   ');
  await assert.rejects(
    draftSources(sql, { note: blank }),
    refused(409, 'This note has no text and links no paper yet.'),
  );
  // A free note with text and no papers is a post from the note.
  const text = await freeNote('Text', 'an idea');
  assert.deepEqual(await draftSources(sql, { note: text }), { paperIds: [], noteIds: [text] });
  // A saved answer citing nothing: its answer is the text.
  const answer = await chatNote({ notebook: empty }, 'An answer.', []);
  assert.deepEqual(await draftSources(sql, { note: answer }), { paperIds: [], noteIds: [answer] });

  const ids: number[] = [];
  for (let i = 0; i < 11; i++) ids.push(await paper(`P${i}`));
  await assert.rejects(draftSources(sql, { papers: ids }), refused(409, /up to 10 papers; this has 11/));
  const big = await createNotebook(sql, 'Big');
  for (const id of ids) await updateNotebook(sql, big, { add: id });
  await assert.rejects(draftSources(sql, { notebook: big }), refused(409, /this has 11/));
  await assert.rejects(draftSources(sql, { papers: [ids[0], 999] }), refused(404, 'Not found'));
  await assert.rejects(draftSources(sql, { papers: [] }), refused(409, 'Pick at least one paper to draft from.'));
  await assert.rejects(draftSources(sql, { paper: 999 }), refused(404, 'Not found'));
  await assert.rejects(draftSources(sql, { notebook: 999 }), refused(404, 'Not found'));
  await assert.rejects(draftSources(sql, { note: 999 }), refused(404, 'Not found'));
});

test("notes hold the owner's writing, highlights and saved answers", async () => {
  const a = await paper('A');
  const c = await paper('C');
  const pa = await paperNote(a, 'my take');
  await paperNote(c, 'not this one');
  await addHighlight(sql, { paperId: a, pid: 'S1.p1', start: 0, end: 5, quote: 'short quote', comment: 'nice' });
  await addHighlight(sql, { paperId: a, pid: 'S1.p2', start: 0, end: 5, quote: 'q'.repeat(2000), comment: '' });
  await chatNote({ paper: a }, 'An answer.', [a]);
  const idea = await freeNote('Idea', 'my idea');

  const { notes, aids, quotes } = await draftNotes(sql, [a], [idea, pa]);
  const all = [...notes, ...aids].join('\n');
  assert.match(notes.join('\n'), /my take/);
  assert.match(notes.join('\n'), /On a line I highlighted in the paper: nice/);
  assert.deepEqual(quotes, [
    { paperId: a, text: 'short quote' },
    { paperId: a, text: 'q'.repeat(300) },
  ]);
  assert.doesNotMatch(all, /short quote|qqq/, "the papers' highlighted words are in neither notes nor aids");
  assert.match(aids.join('\n'), /An answer\./);
  assert.doesNotMatch(notes.join('\n'), /An answer\./, "a saved answer is an aid, not the owner's view");
  assert.doesNotMatch(notes.join('\n'), /^From \[\[/m, "a chat note's generated line is not the owner's");
  assert.doesNotMatch(all, /not this one/);
  assert.match(notes[0], /my idea/, 'the given notes first');
  assert.equal(notes.filter((n) => n.includes('my take')).length, 1, 'each note once');
});

const readySummary = async (a: number, text: string) => {
  const id = (await claimOutput(sql, { paper: a }, 'summary', null, 'run'))!;
  await setOutput(sql, id, {
    status: 'ready',
    body: { papers: [a], sections: [{ heading: 'Summary', claims: [{ text, cites: [] }] }] },
  });
};

test("a paper's summary is an aid", async () => {
  const a = await paper('A');
  await paperNote(a);
  await readySummary(a, 'A says.');
  const { notes, aids } = await draftNotes(sql, [a], []);
  assert.deepEqual(notes, [], 'no writing of the owner: nothing in notes');
  assert.match(aids.join('\n'), /A says\./);
});

/** Every char draftNotes hands the prompt. */
const text = (d: Awaited<ReturnType<typeof draftNotes>>) =>
  [...d.notes, ...d.aids, ...d.quotes.map((q) => q.text)].join('');

test('one note gives at most 4,000 chars in all', async () => {
  const a = await paper('A');
  await paperNote(a, 'b'.repeat(3000));
  await readySummary(a, 's'.repeat(3000));
  for (let i = 0; i < 5; i++)
    await addHighlight(sql, { paperId: a, pid: `S${i}`, start: 0, end: 5, quote: 'q'.repeat(300), comment: '' });
  const { notes, aids, quotes } = await draftNotes(sql, [a], []);
  assert.ok(text({ notes, aids, quotes }).length <= 4000);
  assert.ok(notes[0].length > 3000, "the owner's writing first");
});

test('long highlight comments count toward both caps', async () => {
  const ids: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = await paper(`H${i}`);
    ids.push(a);
    await paperNote(a, 'b'.repeat(1000));
    await readySummary(a, 's'.repeat(3000));
    for (let k = 0; k < 5; k++)
      await addHighlight(sql, {
        paperId: a,
        pid: `S${k}`,
        start: 0,
        end: 5,
        quote: 'q'.repeat(300),
        comment: 'c'.repeat(2000),
      });
  }
  const one = await draftNotes(sql, [ids[0]], []);
  assert.ok(text(one).length <= 4000, String(text(one).length));
  assert.ok(
    one.quotes.every((q) => Object.keys(q).join() === 'paperId,text'),
    'no comment rides on a quote',
  );
  const all = await draftNotes(sql, ids, []);
  assert.equal(text(all).length, 24_000);
  assert.ok(all.notes.every((n) => n.length <= 4000));
});

test('notes are capped', async () => {
  const ids = [await paper('A'), await paper('B'), await paper('C')];
  for (const id of ids) await paperNote(id, 'x'.repeat(10_000));
  const { notes, aids } = await draftNotes(sql, ids, []);
  assert.equal(notes.length, 3);
  assert.ok(notes.every((n) => n.length <= 4000));
  assert.ok([...notes, ...aids].join('').length <= 24_000);

  const many: number[] = [];
  for (let i = 0; i < 8; i++) {
    many.push(await paper(`M${i}`));
    await paperNote(many[i], 'y'.repeat(5000));
  }
  const capped = await draftNotes(sql, many, []);
  assert.equal(capped.notes.join('').length, 24_000);
});

const post = (slug: string, data: string, body = `Body of ${slug}.`) =>
  store.commit([{ path: `src/content/posts/${slug}.md`, content: `---\n${data}\n---\n\n${body}\n` }], 'test', {
    [`src/content/posts/${slug}.md`]: null,
  });

test('voice comes from published posts only', async () => {
  const now = new Date('2026-10-23T12:00:00Z');
  await post('old', 'title: Old\ndate: 2026-01-01');
  await post('mid', 'title: Mid\ndate: 2026-05-01');
  await post('new', 'title: New\ndate: 2026-09-01', 'z'.repeat(5000));
  await post('first', 'title: First\ndate: 2025-01-01');
  await post('draft', 'title: Draft\ndate: 2026-10-01\ndraft: true');
  await post('later', 'title: Later\ndate: 2027-10-01');
  const v = await voiceExamples(store, now);
  assert.equal(v.length, 3);
  assert.ok(v[0].startsWith('# New\n\nzzz'));
  assert.ok(v[1].startsWith('# Mid\n\nBody of mid.'));
  assert.ok(v[2].startsWith('# Old\n\n'));
  assert.equal(v[0].length, 2000);
  assert.doesNotMatch(v.join(), /Draft|Later|First/);
});

test('a broken post gives no voice and never stops a draft', async () => {
  const err = mock.method(console, 'error', () => {});
  mock.method(store, 'list', async () => {
    throw new Error('boom');
  });
  assert.deepEqual(await voiceExamples(store), []);
  assert.equal(err.mock.calls[0].arguments[0], '[reading] voice');
});
