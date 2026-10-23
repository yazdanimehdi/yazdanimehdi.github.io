import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError } from '../admin/store';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { upsertPapers } from './db';
import { publicNotes, republish } from './publish-db';
import { addHighlight, setHighlightPublic } from './room-db';
import type { VaultNote } from './types';
import { createNote, deleteNote, ensurePaperNote, renameNote, setBody, setNotePublic, withTitles } from './vault-db';

let sql: Sql;
let purged: string[];
const deps = {
  purge: async (t: string[]) => void purged.push(...t),
  put: async () => ({ url: '' }),
  del: async () => {},
};
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  purged = [];
});

const make = async (title: string, body = ''): Promise<VaultNote> => {
  const n = (await createNote(sql, title)) as VaultNote;
  if (body) await setBody(sql, n.id, body);
  return n;
};
const doc = async (path: string): Promise<string | null> =>
  (await sql<{ content: string }>`select content from documents where path = ${path}`)[0]?.content ?? null;
const revisions = async () => Number((await sql<{ n: number }>`select count(*)::int as n from revisions`)[0].n);
const countLike = async (like: string) =>
  Number((await sql<{ n: number }>`select count(*)::int as n from documents where path like ${like}`)[0].n);

test('publishing writes the copy; nothing else changes on a second run', async () => {
  const n = await make('My Note', 'hello');
  await setNotePublic(sql, n.id, true);
  assert.deepEqual(await republish(sql, deps), { changed: 1 });
  assert.match((await doc('src/content/notes/my-note.md'))!, /title: My Note[\s\S]*\n\nhello$/);
  const revs = await revisions();
  purged = [];
  assert.deepEqual(await republish(sql, deps), { changed: 0 });
  assert.equal(await revisions(), revs);
  assert.deepEqual(purged, []);
});

test('a commit purges the copy and its collection', async () => {
  const n = await make('My Note', 'hello');
  await setNotePublic(sql, n.id, true);
  await republish(sql, deps);
  assert.ok(purged.includes('col:notes') && purged.includes('doc:notes/my-note'));
  const [r] = await sql<{ updated_by: string }>`select updated_by from documents`;
  assert.equal(r.updated_by, 'Vault');
});

test('a private note never reaches documents', async () => {
  await make('Secret plan', 'private words');
  const pub = await make('Open', 'see [[Secret plan]] and [[secret plan|the plan]]');
  await setNotePublic(sql, pub.id, true);
  await republish(sql, deps);
  const all = (await sql<{ content: string }>`select content from documents`).map((r) => r.content).join('\n');
  assert.ok(!/secret plan/i.test(all) && !all.includes('private words'));
  assert.match(all, /see \(private note\) and the plan/);
});

test('rename keeps the path and updates the linking copy', async () => {
  const a = await make('Alpha');
  const b = await make('Beta', 'see [[Alpha]]');
  await setNotePublic(sql, a.id, true);
  await setNotePublic(sql, b.id, true);
  await republish(sql, deps);
  await renameNote(sql, a.id, 'Alpha Prime');
  assert.deepEqual(await republish(sql, deps), { changed: 2 });
  assert.match((await doc('src/content/notes/alpha.md'))!, /title: Alpha Prime/);
  assert.match((await doc('src/content/notes/beta.md'))!, /\[\[Alpha Prime\]\]/);
  assert.equal(await countLike('src/content/notes/%'), 2);
});

test('unpublishing or deleting a note removes its copy and its links elsewhere', async () => {
  const a = await make('Alpha', 'alpha words');
  const b = await make('Beta', 'see [[Alpha]]');
  const c = await make('Gamma');
  for (const n of [a, b, c]) await setNotePublic(sql, n.id, true);
  await republish(sql, deps);
  assert.match((await doc('src/content/notes/beta.md'))!, new RegExp(`links:\\n  - ${a.uid}\\n`));

  await setNotePublic(sql, a.id, false);
  await deleteNote(sql, c.id);
  assert.deepEqual(await republish(sql, deps), { changed: 3 });
  assert.equal(await doc('src/content/notes/alpha.md'), null);
  assert.equal(await doc('src/content/notes/gamma.md'), null);
  const beta = (await doc('src/content/notes/beta.md'))!;
  assert.match(beta, /links: \[\]/);
  assert.match(beta, /see \(private note\)$/);
  assert.equal(await countLike('src/content/notes/%'), 1);
});

test('a paper copy has only its public highlights; a private paper note has no copy', async () => {
  const [p, q] = (
    await upsertPapers(sql, [
      {
        key: 'arxiv:1',
        arxiv: '1',
        source: 'arxiv',
        title: 'Public Paper',
        authors: ['Ada Lovelace'],
        url: 'https://x.test/1',
        categories: [],
      },
      {
        key: 'arxiv:2',
        arxiv: '2',
        source: 'arxiv',
        title: 'Quiet Paper',
        authors: [],
        url: 'https://x.test/2',
        categories: [],
      },
    ])
  ).map((r) => r.id);
  const pn = await withTitles(sql, (tx) => ensurePaperNote(tx, p));
  await withTitles(sql, (tx) => ensurePaperNote(tx, q));
  const shown = await addHighlight(sql, {
    paperId: p,
    pid: 'S1.p1',
    start: 0,
    end: 5,
    quote: 'shown quote',
    comment: 'mine',
  });
  await addHighlight(sql, { paperId: p, pid: 'S1.p2', start: 0, end: 5, quote: 'hidden quote', comment: 'secret' });
  assert.equal(await setHighlightPublic(sql, shown.id, true), true);
  await setNotePublic(sql, pn.id, true);

  const [n] = await publicNotes(sql);
  assert.equal(n.kind, 'paper');
  assert.equal(n.paper?.title, 'Public Paper');
  assert.deepEqual(n.highlights, [{ pid: 'S1.p1', quote: 'shown quote', comment: 'mine' }]);

  assert.deepEqual(await republish(sql, deps), { changed: 1 });
  const copy = (await doc('src/content/readings/public-paper.md'))!;
  assert.match(copy, /shown quote/);
  assert.match(copy, /Ada Lovelace/);
  assert.ok(!copy.includes('hidden quote') && !copy.includes('secret'));
  assert.equal(await countLike('src/content/readings/%'), 1);
  assert.ok(!(await sql`select content from documents`).some((r) => String(r.content).includes('Quiet Paper')));
});

/** `sql` whose next `times` transactions each lose a race first: another writer commits `path` just before. */
const losing = (path: string, times: number): Sql => {
  const s = ((strings: TemplateStringsArray, ...values: unknown[]) => sql(strings, ...values)) as Sql;
  s.unsafe = (q) => sql.unsafe(q);
  s.begin = async (fn) => {
    if (times-- > 0) await sql`update documents set content = 'stale', version = version + 1 where path = ${path}`;
    return sql.begin(fn);
  };
  return s;
};

test('a run that loses the race recomputes and converges', async () => {
  const a = await make('Alpha', 'one');
  await setNotePublic(sql, a.id, true);
  await republish(sql, deps);
  await setBody(sql, a.id, 'two');
  assert.deepEqual(await republish(losing('src/content/notes/alpha.md', 2), deps), { changed: 1 });
  assert.match((await doc('src/content/notes/alpha.md'))!, /\n\ntwo$/);
  assert.deepEqual(await republish(sql, deps), { changed: 0 });
});

test('three lost races in a row throw', async () => {
  const a = await make('Alpha', 'one');
  await setNotePublic(sql, a.id, true);
  await republish(sql, deps);
  await setBody(sql, a.id, 'two');
  await assert.rejects(republish(losing('src/content/notes/alpha.md', 3), deps), ConflictError);
});
