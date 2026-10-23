import { HttpError } from '../admin/http';
import type { Sql, Tx } from '../db';
import { getPapers, type Row } from './db';
import { listHighlights } from './room-db';
import type { ChatSnapshot, Cite, NoteKind, NoteRow, OutputBody, Target, VaultNote } from './types';
import { noteFile, type NoteContext } from './vault-markdown';
import { noteTitle, numberedTitle, rewriteLinks, wikiLinks } from './vault-links';
import { zip } from './vault-zip';

// The vault's SQL. Conventions as in room-db.ts: timestamps out as ISO strings. A link [[T]] resolves to the note
// whose lower(title) is its vault_links target (lowercased in SQL, whitespace collapsed by wikiLinks).
const iso = (v: unknown) => new Date(v as string | Date).toISOString();

const toNote = (r: Row): VaultNote => ({
  id: Number(r.id),
  kind: r.kind as NoteKind,
  title: r.title as string,
  body: r.body as string,
  paperId: r.paper_id == null ? null : Number(r.paper_id),
  chat: (r.chat as ChatSnapshot | null) ?? null,
  chatId: r.chat_id == null ? null : Number(r.chat_id),
  notebookId: r.notebook_id == null ? null : Number(r.notebook_id),
  suggestedAt: r.suggested_at == null ? null : iso(r.suggested_at),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const toRow = (r: Row): NoteRow => ({
  id: Number(r.id),
  kind: r.kind as NoteKind,
  title: r.title as string,
  updatedAt: iso(r.updated_at),
});

/**
 * A transaction holding the vault's title lock: every insert and rename runs in one, so two can't pick the same title.
 * ponytail: one lock for the whole vault; owner-only writes are rare.
 */
export function withTitles<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(4207)`;
    return fn(tx);
  });
}

const taken = async (tx: Tx, title: string, self?: number) =>
  (
    await tx`select 1 from vault_notes where lower(title) = lower(${title}) and id is distinct from ${self ?? null}::bigint`
  ).length > 0;

/** noteTitle(raw), else '<it> (2)', '<it> (3)'… the first no other note holds, ignoring case. Inside withTitles. */
export async function freeTitle(tx: Tx, raw: string, self?: number): Promise<string> {
  const base = noteTitle(raw);
  let title = base;
  for (let n = 2; await taken(tx, title, self); n++) title = numberedTitle(base, n);
  return title;
}

/** The owner's free note: the exact title (cleaned), no suffix. */
export async function createNote(sql: Sql, raw: string): Promise<VaultNote | 'taken'> {
  return withTitles(sql, async (tx) => {
    const title = noteTitle(raw);
    if (await taken(tx, title)) return 'taken';
    const [r] = await tx<Row>`insert into vault_notes (kind, title) values ('free', ${title}) returning *`;
    return toNote(r);
  });
}

export async function getNote(sql: Tx, id: number): Promise<VaultNote | null> {
  const [r] = await sql<Row>`select * from vault_notes where id = ${id}`;
  return r ? toNote(r) : null;
}

/**
 * q: the title or body contains it; title matches first, then updated_at desc. No limit.
 * ponytail: every title in one response feeds the editor's autocomplete; fine to a few thousand notes.
 */
export async function listNotes(sql: Sql, o: { q?: string; kind?: NoteKind } = {}): Promise<NoteRow[]> {
  const like = o.q ? `%${o.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const rows = await sql<Row>`
    select id, kind, title, updated_at from vault_notes
    where (${o.kind ?? null}::text is null or kind = ${o.kind ?? null})
      and (${like}::text is null or title ilike ${like} or body ilike ${like})
    order by (${like}::text is not null and title ilike ${like}) desc, updated_at desc, id desc`;
  return rows.map(toRow);
}

/** The longest body a note holds: the editor's and the room's limit, and no rewrite or accept goes past it. */
export const MAX_BODY = 20_000;

/**
 * The body, updated_at and the note's vault_links in one statement (atomic without a transaction of its own, so it
 * runs inside the caller's too). False when there is no such note; a 400 with a sentence when over MAX_BODY.
 */
export async function setBody(sql: Tx, id: number, body: string): Promise<boolean> {
  if (body.length > MAX_BODY) {
    const [n] = await sql<Row>`select title from vault_notes where id = ${id}`;
    if (!n) return false;
    throw new HttpError(400, `That would make “${n.title}” longer than ${MAX_BODY.toLocaleString('en')} characters.`);
  }
  const rows = await sql`
    with u as (update vault_notes set body = ${body}, updated_at = now() where id = ${id} returning id),
    t as (select distinct lower(x) as target from unnest(${wikiLinks(body)}::text[]) x),
    d as (delete from vault_links where from_id in (select id from u) and target not in (select target from t)),
    i as (insert into vault_links (from_id, target) select u.id, t.target from u, t on conflict do nothing)
    select id from u`;
  return rows.length > 0;
}

/**
 * noteTitle(raw); 'taken' when another note holds it; else the new title (and the given body, first), and every note
 * linking to the old one has its links rewritten, in the same transaction. null when there is no such note. The
 * notes it rewrites are row-locked as read, so a save landing meanwhile waits and then keeps its own text.
 */
export async function renameNote(
  sql: Sql,
  id: number,
  raw: string,
  body?: string,
): Promise<VaultNote | 'taken' | null> {
  return withTitles(sql, async (tx) => {
    const [cur] = await tx<Row>`select title from vault_notes where id = ${id}`;
    if (!cur) return null;
    const title = noteTitle(raw);
    if (await taken(tx, title, id)) return 'taken';
    const old = cur.title as string;
    if (body !== undefined) await setBody(tx, id, body);
    const linking = await tx<Row>`
      select n.id, n.body from vault_notes n
      where exists (select 1 from vault_links l where l.from_id = n.id and l.target = lower(${old}))
      for update`;
    for (const n of linking) await setBody(tx, Number(n.id), rewriteLinks(n.body as string, old, title));
    await tx`update vault_notes set title = ${title}, updated_at = now() where id = ${id}`;
    return getNote(tx, id);
  });
}

/** A chat note's chat gets saved_at null in the same statement. */
export async function deleteNote(sql: Sql, id: number): Promise<boolean> {
  const rows = await sql`
    with d as (delete from vault_notes where id = ${id} returning chat_id),
    u as (update reading_chats set saved_at = null where id in (select chat_id from d))
    select 1 from d`;
  return rows.length > 0;
}

/** Notes linking to its title, itself excluded, by title. */
export async function backlinks(sql: Sql, id: number): Promise<NoteRow[]> {
  const rows = await sql<Row>`
    select n.id, n.kind, n.title, n.updated_at
    from vault_notes t
    join vault_links l on l.target = lower(t.title)
    join vault_notes n on n.id = l.from_id
    where t.id = ${id} and n.id <> t.id
    order by lower(n.title), n.id`;
  return rows.map(toRow);
}

/**
 * links: resolved links in and out (self-links left out); nodes: the `cap` with most links (ties: updated_at desc);
 * edges: resolved links between kept nodes, each pair once; total: all notes.
 */
export async function graph(
  sql: Sql,
  cap = 200,
): Promise<{ nodes: (NoteRow & { links: number })[]; edges: [number, number][]; total: number }> {
  const rows = await sql<Row>`
    with e as (
      select l.from_id as a, t.id as b from vault_links l join vault_notes t on lower(t.title) = l.target
      where t.id <> l.from_id
    ),
    k as (select id, count(*)::int as links from (select a as id from e union all select b from e) x group by id)
    select n.id, n.kind, n.title, n.updated_at, coalesce(k.links, 0) as links, count(*) over ()::int as total
    from vault_notes n left join k on k.id = n.id
    order by links desc, n.updated_at desc, n.id desc
    limit ${cap}`;
  const ids = rows.map((r) => Number(r.id));
  const edges = await sql<Row>`
    select distinct least(l.from_id, t.id) as a, greatest(l.from_id, t.id) as b
    from vault_links l join vault_notes t on lower(t.title) = l.target
    where t.id <> l.from_id and l.from_id = any(${ids}::bigint[]) and t.id = any(${ids}::bigint[])`;
  return {
    nodes: rows.map((r) => ({ ...toRow(r), links: r.links as number })),
    edges: edges.map((r) => [Number(r.a), Number(r.b)]),
    total: rows.length ? (rows[0].total as number) : 0,
  };
}

/** The paper's note, created (its title made free, body '') when it has none. Inside withTitles. */
export async function ensurePaperNote(tx: Tx, paperId: number): Promise<{ id: number; created: boolean }> {
  const [had] = await tx<Row>`select id from vault_notes where paper_id = ${paperId}`;
  if (had) return { id: Number(had.id), created: false };
  const [p] = await tx<Row>`select title from reading_papers where id = ${paperId}`;
  const title = await freeTitle(tx, p.title as string);
  const [r] = await tx<Row>`
    insert into vault_notes (kind, title, paper_id) values ('paper', ${title}, ${paperId}) returning id`;
  return { id: Number(r.id), created: true };
}

/**
 * A saved answer's note: titled by the question before it, its body 'From [[Paper]], [[…]]' for the chat's paper or
 * the papers it cites (each given its paper note). Inside withTitles.
 */
export async function ensureChatNote(tx: Tx, chatId: number): Promise<{ id: number; created: boolean }> {
  const [had] = await tx<Row>`select id from vault_notes where chat_id = ${chatId}`;
  if (had) return { id: Number(had.id), created: false };
  const [a] = await tx<Row>`
    select a.paper_id, a.body, a.cites, a.created_at, q.body as question
    from reading_chats a
    left join lateral (
      select u.body from reading_chats u
      where u.role = 'user' and u.id < a.id and u.paper_id is not distinct from a.paper_id
        and u.notebook_id is not distinct from a.notebook_id
      order by u.id desc limit 1
    ) q on true
    where a.id = ${chatId}`;
  const cites = a.cites as Cite[];
  const wanted = a.paper_id != null ? [Number(a.paper_id)] : [...new Set(cites.map((c) => c.paper))];
  // A cited paper may have left the notebook and been pruned since.
  const live = new Set(
    (await tx<Row>`select id from reading_papers where id = any(${wanted}::bigint[])`).map((r) => Number(r.id)),
  );
  const titles: string[] = [];
  for (const p of wanted.filter((p) => live.has(p))) {
    const { id } = await ensurePaperNote(tx, p);
    titles.push((await getNote(tx, id))!.title);
  }
  const question = (a.question as string | null) ?? '';
  const chat: ChatSnapshot = {
    question,
    answer: a.body as string,
    cites,
    askedAt: iso(a.created_at),
    origin: a.paper_id != null ? 'paper' : 'notebook',
  };
  const title = await freeTitle(tx, question);
  const [r] = await tx<Row>`
    insert into vault_notes (kind, title, chat, chat_id)
    values ('chat', ${title}, ${JSON.stringify(chat)}::text::jsonb, ${chatId}) returning id`;
  const id = Number(r.id);
  if (titles.length) await setBody(tx, id, `From ${titles.map((t) => `[[${t}]]`).join(', ')}`);
  return { id, created: true };
}

/** The first line ensureChatNote writes, exactly; anything else on it is the owner's. */
const FROM_LINE = /^From \[\[[^\]\n]+\]\](, \[\[[^\]\n]+\]\])*$/;

/**
 * Unsaving an answer: its note goes, unless the owner wrote in it beyond the generated 'From [[…]]' line ('written').
 * The delete only matches the body it checked, so an edit landing in between is kept.
 */
export async function dropChatNote(tx: Tx, chatId: number): Promise<'ok' | 'written'> {
  const [n] = await tx<Row>`select id, body from vault_notes where chat_id = ${chatId}`;
  if (!n) return 'ok';
  const [first, ...more] = (n.body as string).split('\n');
  const rest = FROM_LINE.test(first) ? more.join('\n') : (n.body as string);
  if (rest.trim()) return 'written';
  const gone = await tx`delete from vault_notes where id = ${n.id} and body = ${n.body as string} returning id`;
  return gone.length ? 'ok' : 'written';
}

/** The room's note: the paper's note, or the free note of the notebook; body '' when there is none. Sql or Tx. */
export async function roomNote(sql: Tx, target: Target): Promise<{ id: number | null; body: string }> {
  const [r] = await sql<Row>`
    select id, body from vault_notes
    where paper_id = ${'paper' in target ? target.paper : null}::bigint
      or notebook_id = ${'notebook' in target ? target.notebook : null}::bigint`;
  return r ? { id: Number(r.id), body: r.body as string } : { id: null, body: '' };
}

/** Writes the room's note, creating it unless there is none and the body is blank. Inside withTitles. */
export async function saveRoomNote(tx: Tx, target: Target, body: string): Promise<{ id: number | null }> {
  let { id } = await roomNote(tx, target);
  if (id == null && !body.trim()) return { id: null };
  if ('paper' in target) id = (await ensurePaperNote(tx, target.paper)).id;
  else if (id == null) {
    const [nb] = await tx<Row>`select title from reading_notebooks where id = ${target.notebook}`;
    const title = await freeTitle(tx, nb.title as string);
    const [r] = await tx<Row>`
      insert into vault_notes (kind, title, notebook_id) values ('free', ${title}, ${target.notebook}) returning id`;
    id = Number(r.id);
  }
  await setBody(tx, id, body);
  return { id };
}

/**
 * Each note's NoteContext, in four queries however many notes: a paper note's paper, ready summary and highlights; a
 * notebook chat note's cited papers' authors; a notebook note's notebook title.
 */
export async function noteContexts(sql: Sql, notes: VaultNote[]): Promise<Map<number, NoteContext>> {
  const paperIds = notes.flatMap((n) => (n.paperId == null ? [] : [n.paperId]));
  const cited = notes.flatMap((n) => (n.chat?.origin === 'notebook' ? n.chat.cites.map((c) => c.paper) : []));
  const notebookIds = notes.flatMap((n) => (n.notebookId == null ? [] : [n.notebookId]));
  const [papers, summaries, highlights, notebooks] = await Promise.all([
    getPapers(sql, [...new Set([...paperIds, ...cited])]),
    sql<Row>`
      select paper_id, body from reading_outputs
      where kind = 'summary' and status = 'ready' and paper_id = any(${paperIds}::bigint[])`,
    listHighlights(sql, paperIds),
    sql<Row>`select id, title from reading_notebooks where id = any(${notebookIds}::bigint[])`,
  ]);
  const paper = new Map(papers.map((p) => [p.id, p]));
  const summary = new Map(summaries.map((r) => [Number(r.paper_id), r.body as OutputBody]));
  const notebook = new Map(notebooks.map((r) => [Number(r.id), r.title as string]));
  return new Map(
    notes.map((n) => {
      const authors = new Map<number, { authors: string[] }>();
      if (n.chat?.origin === 'notebook')
        for (const c of n.chat.cites)
          if (paper.has(c.paper)) authors.set(c.paper, { authors: paper.get(c.paper)!.authors });
      const c: NoteContext = { authors };
      if (n.paperId != null) {
        c.paper = paper.get(n.paperId);
        c.summary = summary.get(n.paperId) ?? null;
        c.highlights = highlights
          .filter((h) => h.paperId === n.paperId)
          .map(({ pid, quote, comment }) => ({ pid, quote, comment }));
      }
      if (n.notebookId != null) c.notebook = notebook.get(n.notebookId);
      return [n.id, c];
    }),
  );
}

/** Vercel's 4.5 MB response limit, less room for headers. */
export const EXPORT_MAX = 4_400_000;

/** Every note as an Obsidian file in one zip; refused (413) over `max`, never truncated. */
export async function exportVault(sql: Sql, max = EXPORT_MAX): Promise<Uint8Array> {
  const notes = (await sql<Row>`select * from vault_notes order by id`).map(toNote);
  const ctx = await noteContexts(sql, notes);
  const out = zip(notes.map((n) => noteFile(n, ctx.get(n.id)!)));
  if (out.byteLength > max)
    throw new HttpError(
      413,
      `The vault’s zip is ${(Math.ceil(out.byteLength / 1e5) / 10).toFixed(1)} MB, over the 4.4 MB one download can carry.`,
    );
  return out;
}
