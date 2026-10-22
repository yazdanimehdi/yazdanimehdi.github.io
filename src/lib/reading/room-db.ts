import type { Sql, Tx } from '../db';
import { j, type Row } from './db';
import type {
  ChatMessage,
  Cite,
  Highlight,
  LibraryItem,
  Output,
  OutputBody,
  OutputKind,
  Passage,
  PaperState,
  Target,
  TextSource,
  TextState,
} from './types';

// The reading room's SQL. Conventions as in db.ts: JSON in as `::text::jsonb`, timestamps out as ISO strings.
const iso = (v: unknown) => new Date(v as string | Date).toISOString();
/** [paper_id, notebook_id]: exactly one is set. Queries match `paper_id = $p or notebook_id = $n`. */
const owner = (t: Target): [number | null, number | null] => ('paper' in t ? [t.paper, null] : [null, t.notebook]);

export async function readText(
  sql: Sql,
  paperId: number,
): Promise<TextState & { body: string | null; pdf: Uint8Array | null; passages: number }> {
  const [r] = await sql<Row>`
    select t.source, t.body, t.error, t.note, t.pdf, t.pages,
      (select count(*)::int from reading_passages where paper_id = ${paperId}) as passages
    from (select 1) x left join reading_texts t on t.paper_id = ${paperId}`;
  return {
    source: (r.source as TextSource | null) ?? null,
    error: (r.error as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    pages: (r.pages as number | null) ?? null,
    body: (r.body as string | null) ?? null,
    pdf: (r.pdf as Uint8Array | null) ?? null,
    passages: r.passages as number,
  };
}

/** Replaces the paper's passages in one transaction; seq is the index (reading order). */
export async function savePassages(sql: Sql, paperId: number, passages: Passage[]): Promise<void> {
  await sql.begin((tx) => replacePassages(tx, paperId, passages));
}

/** savePassages inside the caller's transaction (postgres.js has no nested begin). */
export async function replacePassages(tx: Tx, paperId: number, passages: Passage[]): Promise<void> {
  await tx`delete from reading_passages where paper_id = ${paperId}`;
  await tx`
    insert into reading_passages (paper_id, pid, seq, kind, body)
    select ${paperId}, u.pid, (u.n - 1)::int, u.kind, u.body
    from unnest(${passages.map((p) => p.pid)}::text[], ${passages.map((p) => p.kind)}::text[],
      ${passages.map((p) => p.body)}::text[]) with ordinality as u(pid, kind, body, n)`;
}

/** The passages of these papers, by `paperIds` order, then reading order. */
export async function getPassages(sql: Sql, paperIds: number[]): Promise<(Passage & { paperId: number })[]> {
  const rows = await sql<Row>`
    select paper_id, pid, kind, body from reading_passages where paper_id = any(${paperIds}::bigint[])
    order by array_position(${paperIds}::bigint[], paper_id), seq`;
  return rows.map((r) => ({
    paperId: Number(r.paper_id),
    pid: r.pid as string,
    kind: r.kind as Passage['kind'],
    body: r.body as string,
  }));
}

/** Paragraphs and figures matching `to_tsquery('english', tsquery)`, best first. */
export async function searchPassages(
  sql: Sql,
  paperIds: number[],
  tsquery: string,
  limit: number,
): Promise<{ paperId: number; pid: string }[]> {
  const rows = await sql<Row>`
    select paper_id, pid from reading_passages, to_tsquery('english', ${tsquery}) q
    where paper_id = any(${paperIds}::bigint[]) and kind in ('p', 'figure') and tsv @@ q
    order by ts_rank(tsv, q) desc, paper_id, seq limit ${limit}`;
  return rows.map((r) => ({ paperId: Number(r.paper_id), pid: r.pid as string }));
}

/**
 * Reserves the next arXiv slot, `gapMs` after the latest one (site-wide, one statement); returns how long to wait
 * from `now` (0 when free).
 */
export async function reserveArxivSlot(sql: Sql, gapMs = 15_000, now = new Date()): Promise<number> {
  const at = now.toISOString();
  const [r] = await sql<{ wait: number }>`
    insert into reading_settings (id, arxiv_at) values (1, ${at}::timestamptz)
    on conflict (id) do update set
      arxiv_at = greatest(${at}::timestamptz, reading_settings.arxiv_at + ${gapMs} * interval '1 millisecond')
    returning round(extract(epoch from arxiv_at - ${at}::timestamptz) * 1000)::int as wait`;
  return r.wait;
}

/** Counts one AI call for `day` and returns true, or returns false (unchanged) at the cap. */
export async function useAiCall(sql: Sql, day: string, cap: number): Promise<boolean> {
  const rows = await sql`
    insert into reading_ai_use (day, calls) values (${day}::date, 1)
    on conflict (day) do update set calls = reading_ai_use.calls + 1 where reading_ai_use.calls < ${cap}
    returning calls`;
  return rows.length > 0;
}

export async function aiUse(sql: Sql, day: string): Promise<number> {
  const [r] = await sql<{ calls: number }>`select calls from reading_ai_use where day = ${day}::date`;
  return r?.calls ?? 0;
}

export async function getOutputs(
  sql: Sql,
  target: Target,
): Promise<Partial<Record<OutputKind, Output & { id: number; runId: string | null }>>> {
  const [p, n] = owner(target);
  const rows = await sql<Row>`
    select id, kind, status, body, error, run_id, updated_at from reading_outputs
    where paper_id = ${p}::bigint or notebook_id = ${n}::bigint`;
  return Object.fromEntries(
    rows.map((r) => [
      r.kind,
      {
        id: Number(r.id),
        kind: r.kind as OutputKind,
        status: r.status as Output['status'],
        body: (r.body as OutputBody | null) ?? null,
        error: (r.error as string | null) ?? null,
        runId: (r.run_id as string | null) ?? null,
        updatedAt: iso(r.updated_at),
      },
    ]),
  );
}

/**
 * Marks the output running under run `claim`: inserts the row (`expect` null), or flips it only while its run_id is
 * still `expect.runId`. Returns the row id, or null when another start got there first.
 */
export async function claimOutput(
  sql: Sql,
  target: Target,
  kind: OutputKind,
  expect: { runId: string | null } | null,
  claim: string,
): Promise<number | null> {
  const [p, n] = owner(target);
  const rows = expect
    ? await sql<Row>`
        update reading_outputs set status = 'running', run_id = ${claim}, updated_at = now()
        where (paper_id = ${p}::bigint or notebook_id = ${n}::bigint) and kind = ${kind}
          and run_id is not distinct from ${expect.runId}::text
        returning id`
    : await sql<Row>`
        insert into reading_outputs (paper_id, notebook_id, kind, status, run_id)
        values (${p}, ${n}, ${kind}, 'running', ${claim})
        on conflict do nothing returning id`;
  return rows.length ? Number(rows[0].id) : null;
}

/** Changes only the fields given (status always), and bumps updated_at. */
export async function setOutput(
  sql: Sql,
  id: number,
  patch: { status: Output['status']; body?: OutputBody | null; error?: string | null; runId?: string | null },
): Promise<void> {
  const has = (k: keyof typeof patch) => k in patch;
  await sql`
    update reading_outputs set status = ${patch.status},
      body = case when ${has('body')} then ${patch.body ? j(patch.body) : null}::text::jsonb else body end,
      error = case when ${has('error')} then ${patch.error ?? null}::text else error end,
      run_id = case when ${has('runId')} then ${patch.runId ?? null}::text else run_id end,
      updated_at = now()
    where id = ${id}`;
}

export async function deleteOutputs(sql: Sql, paperId: number): Promise<void> {
  await sql`delete from reading_outputs where paper_id = ${paperId}`;
}

/** Saved papers, most recently saved first. */
export async function listSaved(sql: Sql): Promise<LibraryItem[]> {
  const rows = await sql<Row>`
    select id, title, authors, source, url, published_at::text as published_at, state, state_at
    from reading_papers where state = 'saved' order by state_at desc nulls last, id desc`;
  return rows.map((r) => ({
    paper: {
      id: Number(r.id),
      title: r.title as string,
      authors: r.authors as string[],
      source: r.source as string,
      url: r.url as string,
      publishedAt: r.published_at as string | null,
      state: r.state as PaperState,
    },
    savedAt: iso(r.state_at),
  }));
}

export async function createNotebook(sql: Sql, title: string): Promise<number> {
  const [r] = await sql<Row>`insert into reading_notebooks (title) values (${title}) returning id`;
  return Number(r.id);
}

/** Most recently changed first. */
export async function listNotebooks(
  sql: Sql,
): Promise<{ id: number; title: string; papers: number; updatedAt: string }[]> {
  const rows = await sql<Row>`
    select n.id, n.title, n.updated_at,
      (select count(*)::int from reading_notebook_papers p where p.notebook_id = n.id) as papers
    from reading_notebooks n order by n.updated_at desc, n.id desc`;
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title as string,
    papers: r.papers as number,
    updatedAt: iso(r.updated_at),
  }));
}

/** The notebook with its papers in the order they were added; null when there is no such notebook. */
export async function getNotebook(
  sql: Sql,
  id: number,
): Promise<{ id: number; title: string; paperIds: number[] } | null> {
  const [n] = await sql<Row>`select id, title from reading_notebooks where id = ${id}`;
  if (!n) return null;
  const papers = await sql<Row>`
    select paper_id from reading_notebook_papers where notebook_id = ${id} order by added_at, paper_id`;
  return { id: Number(n.id), title: n.title as string, paperIds: papers.map((p) => Number(p.paper_id)) };
}

export const NOTEBOOK_MAX = 20;

/**
 * Renames, adds or removes a paper, and bumps updated_at. 'full' when adding a 21st paper; null when there is no
 * such notebook.
 */
export async function updateNotebook(
  sql: Sql,
  id: number,
  patch: { title?: string; add?: number; remove?: number },
): Promise<'ok' | 'full' | null> {
  return sql.begin(async (tx) => {
    // The update locks the notebook's row, so two adds can't both pass the count.
    const [n] = await tx`
      update reading_notebooks set title = coalesce(${patch.title ?? null}::text, title), updated_at = now()
      where id = ${id} returning id`;
    if (!n) return null;
    if (patch.remove !== undefined)
      await tx`delete from reading_notebook_papers where notebook_id = ${id} and paper_id = ${patch.remove}`;
    if (patch.add !== undefined) {
      const [c] = await tx<{ n: number; has: boolean }>`
        select count(*)::int as n, coalesce(bool_or(paper_id = ${patch.add}), false) as has
        from reading_notebook_papers where notebook_id = ${id}`;
      if (c.has) return 'ok';
      if (c.n >= NOTEBOOK_MAX) return 'full';
      await tx`insert into reading_notebook_papers (notebook_id, paper_id) values (${id}, ${patch.add})`;
    }
    return 'ok';
  });
}

export async function deleteNotebook(sql: Sql, id: number): Promise<boolean> {
  return (await sql`delete from reading_notebooks where id = ${id} returning id`).length > 0;
}

/** The notebooks holding this paper, by title. */
export async function notebooksOf(sql: Sql, paperId: number): Promise<{ id: number; title: string }[]> {
  const rows = await sql<Row>`
    select n.id, n.title from reading_notebooks n join reading_notebook_papers p on p.notebook_id = n.id
    where p.paper_id = ${paperId} order by n.title, n.id`;
  return rows.map((r) => ({ id: Number(r.id), title: r.title as string }));
}

const toChat = (r: Row): ChatMessage => ({
  id: Number(r.id),
  role: r.role as ChatMessage['role'],
  body: r.body as string,
  cites: r.cites as Cite[],
  saved: r.saved_at != null,
  createdAt: iso(r.created_at),
});

/** Oldest first; only the `last` few when given. */
export async function listChat(sql: Sql, target: Target, last?: number): Promise<ChatMessage[]> {
  const [p, n] = owner(target);
  const rows = await sql<Row>`
    select * from (
      select id, role, body, cites, saved_at, created_at from reading_chats
      where paper_id = ${p}::bigint or notebook_id = ${n}::bigint order by id desc limit ${last ?? null}
    ) x order by id`;
  return rows.map(toChat);
}

export async function addChat(
  sql: Tx,
  target: Target,
  m: Pick<ChatMessage, 'role' | 'body' | 'cites'>,
): Promise<ChatMessage> {
  const [p, n] = owner(target);
  const [r] = await sql<Row>`
    insert into reading_chats (paper_id, notebook_id, role, body, cites)
    values (${p}, ${n}, ${m.role}, ${m.body}, ${j(m.cites)}::text::jsonb)
    returning id, role, body, cites, saved_at, created_at`;
  return toChat(r);
}

export async function setChatSaved(sql: Sql, id: number, saved: boolean): Promise<boolean> {
  const rows = await sql`
    update reading_chats set saved_at = case when ${saved} then coalesce(saved_at, now()) end where id = ${id}
    returning id`;
  return rows.length > 0;
}

const toHighlight = (r: Row): Highlight => ({
  id: Number(r.id),
  paperId: Number(r.paper_id),
  pid: r.pid as string,
  start: r.start_at as number,
  end: r.end_at as number,
  quote: r.quote as string,
  comment: r.comment as string,
});

/** By `paperIds` order, then oldest first. */
export async function listHighlights(sql: Sql, paperIds: number[]): Promise<Highlight[]> {
  const rows = await sql<Row>`
    select id, paper_id, pid, start_at, end_at, quote, comment from reading_highlights
    where paper_id = any(${paperIds}::bigint[]) order by array_position(${paperIds}::bigint[], paper_id), id`;
  return rows.map(toHighlight);
}

export async function addHighlight(sql: Sql, h: Omit<Highlight, 'id'>): Promise<Highlight> {
  const [r] = await sql<Row>`
    insert into reading_highlights (paper_id, pid, start_at, end_at, quote, comment)
    values (${h.paperId}, ${h.pid}, ${h.start}, ${h.end}, ${h.quote}, ${h.comment})
    returning id, paper_id, pid, start_at, end_at, quote, comment`;
  return toHighlight(r);
}

export async function setHighlightComment(sql: Sql, id: number, comment: string): Promise<boolean> {
  return (await sql`update reading_highlights set comment = ${comment} where id = ${id} returning id`).length > 0;
}

export async function deleteHighlight(sql: Sql, id: number): Promise<boolean> {
  return (await sql`delete from reading_highlights where id = ${id} returning id`).length > 0;
}

/** '' when there is no note yet. */
export async function getNote(sql: Sql, target: Target): Promise<string> {
  const [p, n] = owner(target);
  const [r] = await sql<Row>`
    select body from reading_notes where paper_id = ${p}::bigint or notebook_id = ${n}::bigint`;
  return (r?.body as string | undefined) ?? '';
}

export async function saveNote(sql: Sql, target: Target, body: string): Promise<void> {
  await ('paper' in target
    ? sql`
        insert into reading_notes (paper_id, body) values (${target.paper}, ${body})
        on conflict (paper_id) where paper_id is not null do update set body = excluded.body, updated_at = now()`
    : sql`
        insert into reading_notes (notebook_id, body) values (${target.notebook}, ${body})
        on conflict (notebook_id) where notebook_id is not null do update set body = excluded.body,
          updated_at = now()`);
}
