import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { HttpError } from '../admin/http';
import { PostgresStore } from '../admin/postgres-store';
import { listEntries, readEntry } from '../admin/content';
import { ConflictError } from '../admin/store';
import { setSqlForTests, type Sql } from '../db';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { isPublished } from '../utils';
import { draftNotes, draftPost, draftSources, voiceExamples } from './blog-draft';
import { saveText, upsertPapers, writeReading } from './db';
import {
  addChat,
  addHighlight,
  aiUse,
  claimOutput,
  createNotebook,
  savePassages,
  setOutput,
  updateNotebook,
  useAiCall,
} from './room-db';
import { createNote, ensureChatNote, ensurePaperNote, saveRoomNote, setBody, withTitles } from './vault-db';

let sql: Sql;
let store: PostgresStore;
let requests: { system: string; prompt: string; documents: number }[];
let reply: string;
let providerError: string | null;
const savedKey = process.env.ANTHROPIC_API_KEY;
const day = () => new Date().toISOString().slice(0, 10);
const draftReply = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ title: 'My post', subtitle: 'Sub', excerpt: 'Ex', tags: ['ml'], body: 'I read it.', ...o });

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  store = new PostgresStore(
    sql,
    { name: 'Owner', email: 'owner@x.test' },
    { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} },
  );
  process.env.ANTHROPIC_API_KEY = 'test-key';
  requests = [];
  reply = draftReply();
  providerError = null;
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    assert.ok(String(input).startsWith('https://api.anthropic.com/'));
    const body = JSON.parse(String(init!.body));
    const content = body.messages[0].content;
    const blocks = typeof content === 'string' ? [{ text: content }] : content;
    requests.push({
      system: body.system,
      prompt: blocks.map((b: { text?: string }) => b.text ?? '').join('\n'),
      documents: blocks.filter((b: { type?: string }) => b.type === 'document').length,
    });
    if (providerError)
      return Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: providerError } },
        { status: 400 },
      );
    assert.match(body.system, /^You draft blog posts/);
    return Response.json({ content: [{ type: 'text', text: reply }] });
  });
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

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

/** A paper whose text is fetched: one passage. */
const ready = async (k: string, body = `Paper ${k} shows that X works.`) => {
  const id = await paper(k);
  await savePassages(sql, id, [{ pid: 'S1.p1', kind: 'p', body }]);
  return id;
};
const slugs = async () => (await listEntries(store, 'posts')).map((e) => e.slug).sort();

test("a paper's draft is an unpublished post in documents", async () => {
  const a = await ready('A');
  const { slug } = await draftPost(sql, store, { paper: a });
  assert.equal(slug, 'my-post');
  const e = (await readEntry(store, 'posts', slug))!;
  assert.equal(e.data.draft, true);
  assert.equal(String(e.data.date).slice(0, 10), day());
  assert.equal(e.data.title, 'My post');
  assert.equal(isPublished({ data: e.data as { draft?: boolean; date: string } }), false);
  const [doc] = await sql`select path from documents where path = ${`src/content/posts/${slug}.md`}`;
  assert.ok(doc, 'the post is a document, in the backup like any other');
  assert.equal(await aiUse(sql, day()), 1);
});

test('a draft is always unpublished, whatever the reply says', async () => {
  const a = await ready('A');
  reply = draftReply({ draft: false });
  const { slug } = await draftPost(sql, store, { paper: a });
  assert.equal((await readEntry(store, 'posts', slug))!.data.draft, true);
});

test("the prompt holds the passages, the owner's notes and past posts", async () => {
  const a = await ready('A', 'The passage of A.');
  await paperNote(a, 'my take');
  await post('pub', 'title: Published one\ndate: 2026-01-01');
  await post('unpub', 'title: Unpublished one\ndate: 2026-01-02\ndraft: true');
  await draftPost(sql, store, { paper: a });
  assert.equal(requests.length, 1);
  const { prompt } = requests[0];
  assert.match(prompt, /The passage of A\./);
  assert.match(prompt, /my take/);
  assert.match(prompt, /Published one/);
  assert.doesNotMatch(prompt, /Unpublished one/);
});

test('a roundup links every paper', async () => {
  const a = await ready('A');
  const b = await ready('B');
  const { slug } = await draftPost(sql, store, { papers: [a, b] });
  const { body } = (await readEntry(store, 'posts', slug))!;
  const list = body.slice(body.indexOf('## Papers'));
  assert.ok(list.includes('https://x.test/A') && list.includes('https://x.test/B'), body);
  assert.match(requests[0].system, /roundup/);
});

test("a note with no papers is a post from the note, with no papers' list", async () => {
  const idea = await freeNote('Idea', 'an idea of mine');
  const { slug } = await draftPost(sql, store, { note: idea });
  assert.match(requests[0].prompt, /Papers: none\./);
  assert.match(requests[0].prompt, /an idea of mine/);
  assert.doesNotMatch((await readEntry(store, 'posts', slug))!.body, /## Papers/);
});

test('a taken slug gets the next number', async () => {
  const a = await ready('A');
  await post('my-post', 'title: Mine\ndate: 2026-01-01');
  assert.deepEqual(await draftPost(sql, store, { paper: a }), { slug: 'my-post-2' });
  reply = draftReply({ title: '注意力' });
  assert.deepEqual(await draftPost(sql, store, { paper: a }), { slug: 'reading-notes' });
});

test('unfetched text is refused before any AI call', async () => {
  const a = await paper('A');
  await assert.rejects(
    draftPost(sql, store, { paper: a }),
    refused(409, 'The paper’s text is still being fetched. Try again in a minute.'),
  );
  const b = await ready('B');
  await assert.rejects(
    draftPost(sql, store, { papers: [b, a] }),
    refused(409, 'A paper’s text is still being fetched. Try again in a minute.'),
  );
  // Worded by the kind of source, as chat words it: a notebook of one paper says "A".
  const nb = await createNotebook(sql, 'One');
  await updateNotebook(sql, nb, { add: a });
  await assert.rejects(
    draftPost(sql, store, { notebook: nb }),
    refused(409, 'A paper’s text is still being fetched. Try again in a minute.'),
  );
  assert.equal(requests.length, 0);
  assert.equal(await aiUse(sql, day()), 0);
});

test('at the cap no AI call is made', async () => {
  const a = await ready('A');
  await writeReading(sql, { prefs: { roomAiCalls: 1 } }, 'test');
  assert.equal(await useAiCall(sql, day(), 1), true);
  await assert.rejects(
    draftPost(sql, store, { paper: a }),
    refused(429, 'Today’s 1 reading-room AI calls are used up. Drafting is back tomorrow.'),
  );
  // The cap holds for a draft from a note alone too.
  const idea = await freeNote('Idea', 'an idea');
  await assert.rejects(draftPost(sql, store, { note: idea }), refused(429, /used up/));
  assert.equal(requests.length, 0);
});

test('a missing key costs no call', async () => {
  const a = await ready('A');
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(draftPost(sql, store, { paper: a }), refused(400, /ANTHROPIC_API_KEY/));
  assert.equal(await aiUse(sql, day()), 0);
  assert.equal(requests.length, 0);
});

test('a provider error writes no post, and a refused draft writes no post', async () => {
  const forty = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ');
  const a = await ready('A', `${forty}.`);
  await post('kept', 'title: Kept\ndate: 2026-01-01');
  const before = await slugs();

  providerError = 'Your credit balance is too low.';
  await assert.rejects(draftPost(sql, store, { paper: a }), refused(502, /credit balance is too low/));
  providerError = null;
  reply = draftReply({ body: `As they say, ${forty}.` });
  await assert.rejects(draftPost(sql, store, { paper: a }), refused(502, /copied a long passage/));
  // A highlighted line is the paper's words too.
  const b = await ready('B');
  await paperNote(b);
  const quote = Array.from({ length: 45 }, (_, i) => `q${i}`).join(' ');
  await addHighlight(sql, { paperId: b, pid: 'S1.p1', start: 0, end: 5, quote, comment: '' });
  reply = draftReply({ body: `They wrote ${quote}.` });
  await assert.rejects(draftPost(sql, store, { paper: b }), refused(502, /copied a long passage/));
  assert.deepEqual(await slugs(), before);
  assert.equal(requests.length, 3, 'one request per attempt, no retry');
  assert.equal(await aiUse(sql, day()), 3, 'one counted call per attempt');
});

test('a scan is drafted from its abstract, never its PDF, and the abstract is copy-checked', async () => {
  const abstract = Array.from({ length: 45 }, (_, i) => `a${i}`).join(' ');
  const [{ id }] = await upsertPapers(sql, [
    {
      key: 'doi:10.1/scan',
      doi: '10.1/scan',
      source: 'doi',
      title: 'A scan',
      authors: ['Ann Scan'],
      url: 'https://x.test/scan',
      categories: [],
      abstract: `${abstract}.`,
    },
  ]);
  await saveText(sql, id, { source: 'scan', pdf: new Uint8Array([37, 80, 68, 70]), pages: 3 });
  await draftPost(sql, store, { paper: id });
  assert.equal(requests[0].documents, 0, 'no PDF is sent');
  assert.ok(requests[0].prompt.includes(abstract));
  const before = await slugs();
  reply = draftReply({ body: `In short, ${abstract}.` });
  await assert.rejects(draftPost(sql, store, { paper: id }), refused(502, /copied a long passage/));
  assert.deepEqual(await slugs(), before);
});

test('a lone scan with no abstract is refused before any AI call, unless the owner wrote a note on it', async () => {
  const [{ id }] = await upsertPapers(sql, [
    {
      key: 'doi:10.1/bare',
      doi: '10.1/bare',
      source: 'doi',
      title: 'Only a title',
      authors: [],
      url: 'https://x.test/bare',
      categories: [],
    },
  ]);
  await saveText(sql, id, { source: 'scan', pdf: new Uint8Array([37, 80, 68, 70]), pages: 3 });
  await assert.rejects(
    draftPost(sql, store, { paper: id }),
    refused(409, 'This paper has only a scan and no abstract to draft from.'),
  );
  assert.equal(requests.length, 0);
  assert.equal(await aiUse(sql, day()), 0);
  await paperNote(id, 'What I make of it.');
  await draftPost(sql, store, { paper: id });
  assert.equal(requests.length, 1);
});

test('a post created under the slug meanwhile is a conflict, and nothing is overwritten', async () => {
  const a = await ready('A');
  await post('my-post', 'title: Mine\ndate: 2026-01-01');
  // The listing misses it, as if it was created after the listing.
  const list = store.list.bind(store);
  mock.method(store, 'list', async (dir: string) => (await list(dir)).filter((f) => !f.path.endsWith('/my-post.md')));
  await assert.rejects(draftPost(sql, store, { paper: a }), ConflictError);
  assert.equal((await readEntry(store, 'posts', 'my-post'))!.data.title, 'Mine');
});
