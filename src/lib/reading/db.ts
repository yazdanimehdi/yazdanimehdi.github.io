import type { Sql } from '../db';
import type { DigestItem, DigestSection, NewPaper, Paper, PaperState, ReadingRun, Signals, TextSource } from './types';

// JSON goes in as `${text}::text::jsonb`: with a bare `::jsonb`, postgres.js sees a jsonb parameter and encodes the
// string again, storing a jsonb string instead of the object (PGlite doesn't, so only a real Postgres shows it).
// Dates come out as `::text`, so a `date` column is never shifted by the client's time zone.
export type Row = Record<string, unknown>;
export const j = (v: unknown) => JSON.stringify(v);

export async function readReading(
  sql: Sql,
): Promise<{ prefs: unknown; lastRun: ReadingRun | null; runId: string | null }> {
  const [r] = await sql<Row>`select prefs, last_run, run_id from reading_settings where id = 1`;
  return {
    prefs: r?.prefs ?? {},
    lastRun: (r?.last_run as ReadingRun | null) ?? null,
    runId: (r?.run_id as string | null) ?? null,
  };
}

/** Upserts the single settings row; only the given fields change. */
export async function writeReading(
  sql: Sql,
  patch: Partial<{ prefs: unknown; lastRun: ReadingRun; runId: string | null }>,
  by: string,
): Promise<void> {
  const has = (k: keyof typeof patch) => k in patch;
  await sql`
    insert into reading_settings (id, prefs, last_run, run_id, updated_by)
    values (1, ${j(patch.prefs ?? {})}::text::jsonb, ${patch.lastRun ? j(patch.lastRun) : null}::text::jsonb,
      ${patch.runId ?? null}, ${by})
    on conflict (id) do update set
      prefs = case when ${has('prefs')} then excluded.prefs else reading_settings.prefs end,
      last_run = case when ${has('lastRun')} then excluded.last_run else reading_settings.last_run end,
      run_id = case when ${has('runId')} then excluded.run_id else reading_settings.run_id end,
      updated_at = now(), updated_by = ${by}`;
}

/**
 * Inserts papers by `key`. A paper seen again keeps its metadata and first source, gets its null ids and abstract
 * filled, and its signals merged per source (the newer source's numbers win). One result per paper, in order.
 */
export async function upsertPapers(sql: Sql, papers: NewPaper[]): Promise<{ id: number; added: boolean }[]> {
  const out: { id: number; added: boolean }[] = [];
  for (const p of papers) {
    const [r] = await sql<Row>`
      insert into reading_papers (key, arxiv, doi, pmid, source, title, authors, abstract, url, published_at,
        categories, signals)
      values (${p.key}, ${p.arxiv ?? null}, ${p.doi ?? null}, ${p.pmid ?? null}, ${p.source}, ${p.title},
        ${j(p.authors)}::text::jsonb, ${p.abstract ?? null}, ${p.url}, ${p.publishedAt ?? null}::date,
        ${j(p.categories)}::text::jsonb, ${j(p.signals ?? {})}::text::jsonb)
      on conflict (key) do update set
        arxiv = coalesce(reading_papers.arxiv, excluded.arxiv),
        doi = coalesce(reading_papers.doi, excluded.doi),
        pmid = coalesce(reading_papers.pmid, excluded.pmid),
        abstract = coalesce(reading_papers.abstract, excluded.abstract),
        signals = reading_papers.signals || excluded.signals
      returning id, (xmax = 0) as added`;
    out.push({ id: Number(r.id), added: r.added as boolean });
  }
  return out;
}

const toPaper = (r: Row): Paper => ({
  id: Number(r.id),
  key: r.key as string,
  arxiv: r.arxiv as string | null,
  doi: r.doi as string | null,
  pmid: r.pmid as string | null,
  source: r.source as string,
  title: r.title as string,
  authors: r.authors as string[],
  abstract: r.abstract as string | null,
  url: r.url as string,
  publishedAt: r.published_at as string | null,
  categories: r.categories as string[],
  signals: r.signals as Signals,
  score: r.score as number | null,
  reason: r.reason as string | null,
  related: r.related as string | null,
  state: r.state as PaperState,
});

/** The papers with these ids, in the order of `ids`; unknown ids are left out. */
export async function getPapers(sql: Sql, ids: number[]): Promise<Paper[]> {
  const rows = await sql<Row>`
    select id, key, arxiv, doi, pmid, source, title, authors, abstract, url, published_at::text as published_at,
      categories, signals, score, reason, related, state
    from reading_papers where id = any(${ids}::bigint[])
    order by array_position(${ids}::bigint[], id)`;
  return rows.map(toPaper);
}

/** False when there is no such paper. */
export async function setPaperState(sql: Sql, id: number, state: PaperState): Promise<boolean> {
  const rows = await sql`update reading_papers set state = ${state}, state_at = now() where id = ${id} returning id`;
  return rows.length > 0;
}

export async function setScore(
  sql: Sql,
  id: number,
  s: { score: number; reason: string; related: string | null },
): Promise<void> {
  await sql`
    update reading_papers set score = ${s.score}, reason = ${s.reason}, related = ${s.related}, scored_at = now()
    where id = ${id}`;
}

/** Each source's numbers replace that source's older ones; other sources are kept. */
export async function mergeSignals(sql: Sql, id: number, s: Signals): Promise<void> {
  await sql`update reading_papers set signals = signals || ${j(s)}::text::jsonb where id = ${id}`;
}

/** Each paper's latest showing on a day before `day` (so a second run the same day doesn't count today's). */
export async function shownBefore(
  sql: Sql,
  ids: number[],
  day: string,
): Promise<Map<number, { section: DigestSection; signals: Signals | null }>> {
  const rows = await sql<Row>`
    select distinct on (paper_id) paper_id, section, signals from reading_digest
    where paper_id = any(${ids}::bigint[]) and day < ${day}::date
    order by paper_id, day desc`;
  return new Map(
    rows.map((r) => [
      Number(r.paper_id),
      { section: r.section as DigestSection, signals: (r.signals as Signals | null) ?? null },
    ]),
  );
}

/** Replaces that day's items in one transaction. */
export async function saveDigest(
  sql: Sql,
  day: string,
  items: { paperId: number; section: DigestSection; rank: number; line: string; signals?: Signals }[],
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`delete from reading_digest where day = ${day}::date`;
    for (const i of items) {
      await tx`
        insert into reading_digest (day, paper_id, section, rank, line, signals)
        values (${day}::date, ${i.paperId}, ${i.section}, ${i.rank}, ${i.line},
          ${i.signals ? j(i.signals) : null}::text::jsonb)`;
    }
  });
}

/**
 * The latest `days` digests before `before` (exclusive), newest first. Dismissed papers are left out (a day whose
 * papers were all dismissed comes back empty); items run talked, field, unranked, each by rank.
 */
export async function listDigests(
  sql: Sql,
  opts: { before?: string; days: number },
): Promise<{ day: string; items: DigestItem[] }[]> {
  const before = opts.before ?? null;
  const days = await sql<{ day: string }>`
    select distinct day::text as day from reading_digest where ${before}::date is null or day < ${before}::date
    order by day desc limit ${opts.days}`;
  const out = days.map((d) => ({ day: d.day, items: [] as DigestItem[] }));
  const byDay = new Map(out.map((d) => [d.day, d.items]));
  const rows = await sql<Row>`
    select d.day::text as day, d.section, d.rank, d.line, p.id, p.title, p.authors, p.source, p.url,
      p.published_at::text as published_at, p.state
    from reading_digest d join reading_papers p on p.id = d.paper_id
    where d.day = any(${days.map((d) => d.day)}::date[]) and p.state <> 'dismissed'
    order by d.day desc, array_position(array['talked', 'field', 'unranked'], d.section), d.rank`;
  for (const r of rows) {
    byDay.get(r.day as string)!.push({
      section: r.section as DigestSection,
      rank: r.rank as number,
      line: r.line as string,
      paper: {
        id: Number(r.id),
        title: r.title as string,
        authors: r.authors as string[],
        source: r.source as string,
        url: r.url as string,
        publishedAt: r.published_at as string | null,
        state: r.state as PaperState,
      },
    });
  }
  return out;
}

/** How many items that day's digest shows: dismissed papers are left out, as on the page. */
export async function todayCount(sql: Sql, day: string): Promise<number> {
  const [r] = await sql<{ n: number }>`
    select count(*)::int as n from reading_digest d join reading_papers p on p.id = d.paper_id
    where d.day = ${day}::date and p.state <> 'dismissed'`;
  return r.n;
}

/** Deletes untouched candidates: state 'new', found over 30 days ago, never in a digest. Returns how many. */
export async function pruneCandidates(sql: Sql): Promise<number> {
  const rows = await sql`
    delete from reading_papers p
    where state = 'new' and found_at < now() - interval '30 days'
      and not exists (select 1 from reading_digest d where d.paper_id = p.id)
    returning id`;
  return rows.length;
}

/** Of these papers, those with an arXiv id and no `reading_texts` row or a failed (retryable) fetch, in `ids` order. */
export async function missingTexts(sql: Sql, ids: number[]): Promise<number[]> {
  const rows = await sql<Row>`
    select id from reading_papers p
    where id = any(${ids}::bigint[]) and arxiv is not null
      and not exists (select 1 from reading_texts t where t.paper_id = p.id and t.error is null)
    order by array_position(${ids}::bigint[], id)`;
  return rows.map((r) => Number(r.id));
}

/** Upserts the paper's text; omitted fields are stored as null. */
export async function saveText(
  sql: Sql,
  paperId: number,
  t: {
    source: TextSource;
    body?: string | null;
    error?: string | null;
    note?: string | null;
    pdf?: Uint8Array | null;
    pages?: number | null;
  },
): Promise<void> {
  await sql`
    insert into reading_texts (paper_id, source, body, error, note, pdf, pages)
    values (${paperId}, ${t.source}, ${t.body ?? null}, ${t.error ?? null}, ${t.note ?? null}, ${t.pdf ?? null},
      ${t.pages ?? null})
    on conflict (paper_id) do update set source = excluded.source, body = excluded.body, error = excluded.error,
      note = excluded.note, pdf = excluded.pdf, pages = excluded.pages, fetched_at = now()`;
}
