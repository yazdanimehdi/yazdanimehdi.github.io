import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { HttpError } from '../admin/http';
import { PostgresStore } from '../admin/postgres-store';
import { setSqlForTests, type Sql } from '../db';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { askChat } from './chat';
import { upsertPapers, writeReading } from './db';
import { addChat, aiUse, createNotebook, listChat, savePassages, updateNotebook, useAiCall } from './room-db';
import type { NewPaper, Passage } from './types';

let sql: Sql;
let store: PostgresStore;
let requests: { system: string; prompt: string }[];
let reply: string;
let providerError: string | null;
const savedKey = process.env.ANTHROPIC_API_KEY;
const day = () => new Date().toISOString().slice(0, 10);

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
  reply = 'An answer.';
  providerError = null;
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    assert.ok(String(input).startsWith('https://api.anthropic.com/'));
    const body = JSON.parse(String(init!.body));
    const content = body.messages[0].content;
    const blocks = typeof content === 'string' ? [{ text: content }] : content;
    requests.push({ system: body.system, prompt: blocks.map((b: { text?: string }) => b.text ?? '').join('\n') });
    if (providerError)
      return Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: providerError } },
        { status: 400 },
      );
    assert.match(body.system, /^You answer questions/);
    return Response.json({ content: [{ type: 'text', text: reply }] });
  });
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

const paper = (key: string): NewPaper => ({
  key,
  source: 'arxiv',
  title: `Paper ${key}`,
  authors: ['A. Author'],
  url: `https://x.test/${key}`,
  categories: [],
  abstract: `The abstract of ${key}.`,
  arxiv: key,
});
const p = (pid: string, body: string): Passage => ({ pid, kind: 'p', body });
/** A paper with these passages stored. */
const add = async (key: string, passages: Passage[]) => {
  const [{ id }] = await upsertPapers(sql, [paper(key)]);
  if (passages.length) await savePassages(sql, id, passages);
  return id;
};
const refused = (status: number, message: string) => (e: unknown) =>
  e instanceof HttpError && e.status === status && e.message === message;

test('an answer is stored with its cites and the question', async () => {
  const id = await add('2310.06825', [p('abs.1', 'We study X.'), p('S1.p1', 'X works.')]);
  reply = `X works [${id}:S1.p1]. So says [999:S1.p1].`;
  const { question, answer } = await askChat(sql, store, { paper: id }, '  Does X work?  ');
  assert.equal(question.body, 'Does X work?');
  assert.deepEqual(answer.cites, [{ paper: id, pid: 'S1.p1' }]);
  assert.equal(answer.body, `X works [${id}:S1.p1]. So says.`);
  assert.deepEqual(
    (await listChat(sql, { paper: id })).map((m) => [m.role, m.body]),
    [
      ['user', 'Does X work?'],
      ['assistant', answer.body],
    ],
  );
  assert.equal(await aiUse(sql, day()), 1);
});

test("chat sends the owner's profile and earlier turns", async () => {
  await sql`insert into documents (path, content) values
    ('src/content/publications/mirage.md', ${"---\ntitle: 'MIRAGE: Retrieval for Dialects'\n---\n"})`;
  const id = await add('2310.06825', [p('S1.p1', 'X works.')]);
  await addChat(sql, { paper: id }, { role: 'user', body: 'What is X?', cites: [] });
  await addChat(sql, { paper: id }, { role: 'assistant', body: 'X is a method.', cites: [] });
  await askChat(sql, store, { paper: id }, 'How does this compare to MIRAGE?');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].system.includes('MIRAGE: Retrieval for Dialects'));
  assert.match(requests[0].prompt, /Owner: What is X\?\nYou: X is a method\./);
  assert.match(requests[0].prompt, /Owner: How does this compare to MIRAGE\?$/);
});

test('at the cap chat says so', async () => {
  const id = await add('2310.06825', [p('S1.p1', 'X works.')]);
  await writeReading(sql, { prefs: { roomAiCalls: 1 } }, 'test');
  assert.equal(await useAiCall(sql, day(), 1), true);
  await assert.rejects(
    askChat(sql, store, { paper: id }, 'Does X work?'),
    refused(
      429,
      'Today’s 1 reading-room AI calls are used up. Chat is back tomorrow; the rest of the page still works.',
    ),
  );
  assert.equal(requests.length, 0);
  assert.deepEqual(await listChat(sql, { paper: id }), []);
});

test('chat waits for the text', async () => {
  const id = await add('2310.06825', []);
  await assert.rejects(
    askChat(sql, store, { paper: id }, 'Does X work?'),
    refused(409, 'The paper’s text is still being fetched. Try again in a minute.'),
  );
  const ready = await add('2310.06826', [p('S1.p1', 'X works.')]);
  const notebook = await createNotebook(sql, 'Two');
  await updateNotebook(sql, notebook, { add: ready });
  await updateNotebook(sql, notebook, { add: id });
  await assert.rejects(
    askChat(sql, store, { notebook }, 'Does X work?'),
    refused(409, 'A paper’s text is still being fetched. Try again in a minute.'),
  );
  assert.equal(requests.length, 0);
  assert.equal(await aiUse(sql, day()), 0);
});

test('a big notebook is grounded on the passages matching the question', async () => {
  const filler = 'Nothing relevant is said in this sentence at all. '.repeat(4);
  const a = await add('2310.06825', [p('S1.p1', `The cat sat on the mat. ${filler}`), p('S1.p2', filler)]);
  const b = await add('2310.06826', [p('S1.p1', `Quantum entanglement is measured here. ${filler}`)]);
  const notebook = await createNotebook(sql, 'Big');
  await updateNotebook(sql, notebook, { add: a });
  await updateNotebook(sql, notebook, { add: b });
  await askChat(sql, store, { notebook }, 'How is entanglement measured?', { budget: 300 });
  assert.match(requests[0].prompt, new RegExp(`^\\[${b}:S1\\.p1\\] Quantum entanglement`, 'm'));
  assert.ok(!requests[0].prompt.includes('The cat sat'));
});

test('a missing key costs no call', async () => {
  const id = await add('2310.06825', [p('S1.p1', 'X works.')]);
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(askChat(sql, store, { paper: id }, 'Does X work?'), (e: unknown) => {
    assert.ok(e instanceof HttpError && e.status === 400);
    assert.match(e.message, /ANTHROPIC_API_KEY/);
    return true;
  });
  assert.equal(await aiUse(sql, day()), 0);
  assert.equal(requests.length, 0);
});

test('a provider error stores nothing', async () => {
  const id = await add('2310.06825', [p('S1.p1', 'X works.')]);
  providerError = 'Your credit balance is too low.';
  await assert.rejects(askChat(sql, store, { paper: id }, 'Does X work?'), (e: unknown) => {
    assert.ok(e instanceof HttpError && e.status === 502);
    assert.match(e.message, /credit balance is too low/);
    return true;
  });
  assert.deepEqual(await listChat(sql, { paper: id }), []);
});

test('an empty or long question, an unknown target and an empty notebook are refused', async () => {
  const id = await add('2310.06825', [p('S1.p1', 'X works.')]);
  const tooLong = 'Ask a question of up to 2,000 characters';
  await assert.rejects(askChat(sql, store, { paper: id }, '   '), refused(400, tooLong));
  await assert.rejects(askChat(sql, store, { paper: id }, 'x'.repeat(2001)), refused(400, tooLong));
  await assert.rejects(askChat(sql, store, { paper: id + 99 }, 'Why?'), refused(404, 'Not found'));
  await assert.rejects(askChat(sql, store, { notebook: 99 }, 'Why?'), refused(404, 'Not found'));
  const empty = await createNotebook(sql, 'Empty');
  await assert.rejects(
    askChat(sql, store, { notebook: empty }, 'Why?'),
    refused(409, 'This notebook has no papers yet.'),
  );
  assert.equal(requests.length, 0);
});
