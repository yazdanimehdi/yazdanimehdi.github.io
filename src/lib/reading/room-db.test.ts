import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { saveText, upsertPapers } from './db';
import { ensurePaperNote, withTitles } from './vault-db';
import {
  addChat,
  addHighlight,
  aiUse,
  claimOutput,
  createNotebook,
  getOutputs,
  getPassages,
  readText,
  reserveArxivSlot,
  savePassages,
  searchPassages,
  setOutput,
  updateNotebook,
  useAiCall,
} from './room-db';

let sql: Sql;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});

const newPapers = async (n: number) =>
  (
    await upsertPapers(
      sql,
      Array.from({ length: n }, (_, i) => ({
        key: `arxiv:${i}`,
        arxiv: String(i),
        source: 'arxiv',
        title: `Paper ${i}`,
        authors: [],
        url: `https://x.test/${i}`,
        categories: [],
      })),
    )
  ).map((r) => r.id);

test("savePassages replaces a paper's passages and keeps reading order", async () => {
  const [a, b] = await newPapers(2);
  await savePassages(sql, a, [
    { pid: 'S1', kind: 'h2', body: 'Intro' },
    { pid: 'S1.p1', kind: 'p', body: 'old' },
  ]);
  await savePassages(sql, b, [{ pid: 'abs.1', kind: 'p', body: 'b text' }]);
  await savePassages(sql, a, [
    { pid: 'S2.p1', kind: 'p', body: 'second' },
    { pid: 'S1.p1', kind: 'p', body: 'first' },
  ]);
  assert.deepEqual(await getPassages(sql, [b, a]), [
    { paperId: b, pid: 'abs.1', kind: 'p', body: 'b text' },
    { paperId: a, pid: 'S2.p1', kind: 'p', body: 'second' },
    { paperId: a, pid: 'S1.p1', kind: 'p', body: 'first' },
  ]);
  assert.equal((await readText(sql, a)).passages, 2);
});

test('searchPassages ranks by the query and skips headings', async () => {
  const [a] = await newPapers(1);
  await savePassages(sql, a, [
    { pid: 'S1', kind: 'h2', body: 'Attention and translation' },
    { pid: 'S1.p1', kind: 'p', body: 'We study translation of long documents.' },
    { pid: 'S1.p2', kind: 'p', body: 'Attention helps translation: attention weights align the words.' },
  ]);
  assert.deepEqual(await searchPassages(sql, [a], 'attention | translation', 10), [
    { paperId: a, pid: 'S1.p2' },
    { paperId: a, pid: 'S1.p1' },
  ]);
});

test('readText reports a missing text, then the stored one with its scan', async () => {
  const [a] = await newPapers(1);
  assert.deepEqual(await readText(sql, a), {
    source: null,
    error: null,
    note: null,
    pages: null,
    body: null,
    pdf: null,
    passages: 0,
  });
  await saveText(sql, a, { source: 'scan', pdf: new Uint8Array([37, 80, 68, 70]), pages: 3 });
  const t = await readText(sql, a);
  assert.deepEqual([t.source, t.body, t.error, t.pages], ['scan', null, null, 3]);
  assert.deepEqual([...t.pdf!], [37, 80, 68, 70]);
});

test('reserveArxivSlot hands out slots 15 s apart', async () => {
  const now = new Date('2026-10-22T10:00:00Z');
  assert.equal(await reserveArxivSlot(sql, 15_000, now), 0);
  assert.equal(await reserveArxivSlot(sql, 15_000, now), 15_000);
  assert.equal(await reserveArxivSlot(sql, 15_000, now), 30_000);
  assert.equal(await reserveArxivSlot(sql, 15_000, new Date(now.getTime() + 60_000)), 0);
});

test('useAiCall stops at the cap', async () => {
  assert.equal(await useAiCall(sql, '2026-10-22', 2), true);
  assert.equal(await useAiCall(sql, '2026-10-22', 2), true);
  assert.equal(await useAiCall(sql, '2026-10-22', 2), false);
  assert.equal(await aiUse(sql, '2026-10-22'), 2);
  assert.equal(await aiUse(sql, '2026-10-23'), 0);
  assert.equal(await useAiCall(sql, '2026-10-23', 2), true);
  assert.equal(await aiUse(sql, '2026-10-23'), 1);
});

test('claimOutput lets only one start win', async () => {
  const [a] = await newPapers(1);
  const target = { paper: a };
  const id = await claimOutput(sql, target, 'summary', null, 'r1');
  assert.ok(id);
  assert.equal(await claimOutput(sql, target, 'summary', null, 'r1b'), null, 'the row exists already');
  const [first, second] = [
    await claimOutput(sql, target, 'summary', { runId: 'r1' }, 'r2'),
    await claimOutput(sql, target, 'summary', { runId: 'r1' }, 'r3'),
  ];
  assert.equal(first, id);
  assert.equal(second, null);
});

test('setOutput changes only the fields it is given', async () => {
  const [a] = await newPapers(1);
  const id = (await claimOutput(sql, { paper: a }, 'summary', null, 'r1'))!;
  const body = { papers: [a], sections: [{ heading: 'Gist', claims: [{ text: 'x', cites: [] }] }] };
  await setOutput(sql, id, { status: 'ready', body, runId: null });
  await setOutput(sql, id, { status: 'running', runId: 'r2' });
  const { summary } = await getOutputs(sql, { paper: a });
  assert.deepEqual([summary?.status, summary?.body, summary?.error, summary?.runId], ['running', body, null, 'r2']);
});

test('updateNotebook refuses a 21st paper', async () => {
  const papers = await newPapers(21);
  const nb = await createNotebook(sql, 'Attention');
  for (const p of papers.slice(0, 20)) assert.equal(await updateNotebook(sql, nb, { add: p }), 'ok');
  assert.equal(await updateNotebook(sql, nb, { add: papers[20] }), 'full');
  assert.equal(await updateNotebook(sql, nb, { add: papers[0] }), 'ok', 'adding a paper already in it is fine');
  assert.equal(await updateNotebook(sql, nb + 1, { title: 'x' }), null);
});

test('deleting a paper keeps no orphans', async () => {
  const [a, b] = await newPapers(2);
  const nb = await createNotebook(sql, 'N');
  await updateNotebook(sql, nb, { add: a });
  await updateNotebook(sql, nb, { add: b });
  await savePassages(sql, a, [{ pid: 'abs.1', kind: 'p', body: 'x' }]);
  await claimOutput(sql, { paper: a }, 'summary', null, 'r');
  await addChat(sql, { paper: a }, { role: 'user', body: 'q', cites: [] });
  await addHighlight(sql, { paperId: a, pid: 'abs.1', start: 0, end: 1, quote: 'x', comment: '' });
  await sql`delete from reading_papers where id = ${a}`;
  const [left] = await sql`
    select (select count(*)::int from reading_passages where paper_id = ${a}) as passages,
      (select count(*)::int from reading_outputs where paper_id = ${a}) as outputs,
      (select count(*)::int from reading_chats where paper_id = ${a}) as chats,
      (select count(*)::int from reading_highlights where paper_id = ${a}) as highlights`;
  assert.deepEqual(left, { passages: 0, outputs: 0, chats: 0, highlights: 0 });
  assert.deepEqual(
    (await sql<{ paper_id: number }>`select paper_id from reading_notebook_papers`).map((r) => Number(r.paper_id)),
    [b],
  );
});

test("a paper with a vault note can't be deleted", async () => {
  const [a] = await newPapers(1);
  await withTitles(sql, (tx) => ensurePaperNote(tx, a));
  await assert.rejects(sql`delete from reading_papers where id = ${a}`, /vault_notes_paper_id_fkey/);
});
