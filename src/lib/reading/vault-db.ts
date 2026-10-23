import type { Sql, Tx } from '../db';
import type { Row } from './db';
import type { ChatSnapshot, NoteKind, NoteRow, VaultNote } from './types';
import { noteTitle, numberedTitle, rewriteLinks, wikiLinks } from './vault-links';

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

/**
 * The body, updated_at and the note's vault_links in one statement (atomic without a transaction of its own, so it
 * runs inside the caller's too). False when there is no such note.
 */
export async function setBody(sql: Tx, id: number, body: string): Promise<boolean> {
  const rows = await sql`
    with u as (update vault_notes set body = ${body}, updated_at = now() where id = ${id} returning id),
    t as (select distinct lower(x) as target from unnest(${wikiLinks(body)}::text[]) x),
    d as (delete from vault_links where from_id in (select id from u) and target not in (select target from t)),
    i as (insert into vault_links (from_id, target) select u.id, t.target from u, t on conflict do nothing)
    select id from u`;
  return rows.length > 0;
}

/**
 * noteTitle(raw); 'taken' when another note holds it; else the new title, and every note linking to the old one has
 * its links rewritten, in the same transaction. null when there is no such note.
 */
export async function renameNote(sql: Sql, id: number, raw: string): Promise<VaultNote | 'taken' | null> {
  return withTitles(sql, async (tx) => {
    const [cur] = await tx<Row>`select title from vault_notes where id = ${id}`;
    if (!cur) return null;
    const title = noteTitle(raw);
    if (await taken(tx, title, id)) return 'taken';
    const old = cur.title as string;
    await tx`update vault_notes set title = ${title}, updated_at = now() where id = ${id}`;
    const linking = await tx<Row>`
      select n.id, n.body from vault_notes n
      where exists (select 1 from vault_links l where l.from_id = n.id and l.target = lower(${old}))`;
    for (const n of linking) await setBody(tx, Number(n.id), rewriteLinks(n.body as string, old, title));
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
