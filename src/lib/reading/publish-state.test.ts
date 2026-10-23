import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { upsertPapers } from './db';
import { addChat, addHighlight, setHighlightPublic } from './room-db';
import { highlightLockProbe } from './test-locks';
import { createNote, ensureChatNote, renameNote, setNotePublic, withTitles } from './vault-db';
import type { Highlight, VaultNote } from './types';

let sql: Sql;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});

const make = async (title: string): Promise<VaultNote> => {
  const n = await createNote(sql, title);
  assert.notEqual(n, 'taken');
  return n as VaultNote;
};
const paper = async (n: number) =>
  (
    await upsertPapers(sql, [
      {
        key: `arxiv:${n}`,
        arxiv: String(n),
        source: 'arxiv',
        title: `P${n}`,
        authors: [],
        url: `https://x.test/${n}`,
        categories: [],
      },
    ])
  )[0].id;
const highlights = async (paperId: number, count: number): Promise<Highlight[]> => {
  const hs: Highlight[] = [];
  for (let i = 0; i < count; i++)
    hs.push(await addHighlight(sql, { paperId, pid: `S1.p${i}`, start: 0, end: 5, quote: 'quote', comment: '' }));
  return hs;
};

test('a note gets a uuid and starts private', async () => {
  const n = await make('Attention');
  assert.match(n.uid, /^[0-9a-f-]{36}$/);
  assert.equal(n.public, false);
  assert.equal(n.publicSlug, null);
  assert.equal(n.publicAt, null);
});

test('first publish fixes the slug; rename and unpublish keep it', async () => {
  const n = await make('Attention Is All You Need');
  const p = (await setNotePublic(sql, n.id, true)) as VaultNote;
  assert.equal(p.public, true);
  assert.equal(p.publicSlug, 'attention-is-all-you-need');
  assert.ok(p.publicAt);
  await renameNote(sql, n.id, 'Transformers');
  const off = (await setNotePublic(sql, n.id, false)) as VaultNote;
  assert.equal(off.public, false);
  assert.equal(off.publicSlug, 'attention-is-all-you-need');
  const again = (await setNotePublic(sql, n.id, true)) as VaultNote;
  assert.equal(again.publicSlug, 'attention-is-all-you-need');
  assert.equal(again.publicAt, p.publicAt);
  assert.equal(await setNotePublic(sql, 999, true), null);
});

test('slugs are unique, and a title without ASCII letters uses the uid', async () => {
  const a = await make('Same');
  const b = await make('same!');
  await setNotePublic(sql, a.id, true);
  assert.equal(((await setNotePublic(sql, b.id, true)) as VaultNote).publicSlug, 'same-2');
  const c = await make('یادداشت');
  const pc = (await setNotePublic(sql, c.id, true)) as VaultNote;
  assert.equal(pc.publicSlug, `note-${c.uid.slice(0, 8)}`);
});

test('a chat note cannot be public', async () => {
  const p = await paper(1);
  await addChat(sql, { paper: p }, { role: 'user', body: 'Q?', cites: [] });
  const ans = await addChat(sql, { paper: p }, { role: 'assistant', body: 'A.', cites: [] });
  const { id } = await withTitles(sql, (tx) => ensureChatNote(tx, ans.id));
  assert.equal(await setNotePublic(sql, id, true), 'chat');
  assert.equal(((await setNotePublic(sql, id, false)) as VaultNote).public, false);
  await assert.rejects(sql`update vault_notes set public = true where id = ${id}`, /check/);
});

test('a paper shares at most 10 highlights', async () => {
  const hs = await highlights(await paper(1), 11);
  for (const h of hs.slice(0, 10)) assert.equal(await setHighlightPublic(sql, h.id, true), true);
  assert.equal(await setHighlightPublic(sql, hs[10].id, true), 'full');
  assert.equal(await setHighlightPublic(sql, hs[0].id, true), true, 'already public: not a new one');
  assert.equal(await setHighlightPublic(sql, hs[0].id, false), true);
  assert.equal(await setHighlightPublic(sql, hs[10].id, true), true);
  assert.equal(await setHighlightPublic(sql, 999, true), false);
  const [other] = await highlights(await paper(2), 1);
  assert.equal(await setHighlightPublic(sql, other.id, true), true, "another paper's count is its own");
});

test('two concurrent toggles at 9 cannot both pass', async () => {
  // pglite has one connection: instead of racing two toggles, check that the count is taken with every highlight of
  // the paper row-locked, so under postgres a second toggle waits for the first to commit and then counts 10.
  const hs = await highlights(await paper(1), 11);
  const [other] = await highlights(await paper(2), 1);
  for (const h of hs.slice(0, 9)) await setHighlightPublic(sql, h.id, true);
  const probe = highlightLockProbe(sql);
  assert.equal(await setHighlightPublic(probe.sql, hs[9].id, true), true);
  assert.deepEqual(probe.writes, [hs.map((h) => h.id)]);
  assert.ok(!probe.writes[0].includes(other.id));
});
