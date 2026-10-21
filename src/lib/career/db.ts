import type { Sql } from '../db';
import type { DraftState, GuardFlags, Posting, PostingStatus, PostingSummary, RawPosting, RunSummary } from './types';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());

/** Inserts postings it has not seen (by `key`); a posting seen again only gets `last_seen_at` bumped. Returns the new rows. */
export async function upsertPostings(
  sql: Sql,
  rows: (RawPosting & { key: string; text: string; flags: GuardFlags })[],
): Promise<number> {
  let added = 0;
  for (const r of rows) {
    const out = await sql<{ inserted: boolean }>`
      insert into career_postings (key, source, external_id, company, title, location, remote, url, apply_url,
        description, flags, salary, ats, posted_at)
      values (${r.key}, ${r.source}, ${r.externalId}, ${r.company}, ${r.title}, ${r.location ?? null}, ${r.remote ?? null},
        ${r.url}, ${r.applyUrl ?? null}, ${r.text}, ${JSON.stringify(r.flags)}::jsonb,
        ${r.salary ? JSON.stringify(r.salary) : null}::jsonb, ${r.ats ? JSON.stringify(r.ats) : null}::jsonb,
        ${r.postedAt ?? null})
      on conflict (key) do update set last_seen_at = clock_timestamp()
      returning (xmax = 0) as inserted`;
    if (out[0]?.inserted) added++;
  }
  return added;
}

export async function listPostings(
  sql: Sql,
  f: { status?: PostingStatus; scored?: boolean; limit?: number },
): Promise<PostingSummary[]> {
  const rows = await sql<Row>`
    select id, company, title, location, remote, score, gate, status, found_at, flags, draft_state
    from career_postings
    where (${f.status ?? null}::text is null or status = ${f.status ?? null})
      and (${f.scored ?? null}::boolean is null or (score is not null) = ${f.scored ?? null})
    order by score desc nulls last, found_at desc
    limit ${f.limit ?? 200}`;
  return rows.map((r) => ({
    id: Number(r.id),
    company: r.company as string,
    title: r.title as string,
    location: r.location as string | null,
    remote: r.remote as boolean | null,
    score: r.score as number | null,
    gate: r.gate as string | null,
    status: r.status as PostingStatus,
    foundAt: iso(r.found_at)!,
    flagged: !!(r.flags as GuardFlags).warn,
    draftState: r.draft_state as DraftState,
  }));
}

export async function getPosting(sql: Sql, id: number): Promise<Posting | null> {
  const [r] = await sql<Row>`select * from career_postings where id = ${id}`;
  if (!r) return null;
  return {
    id: Number(r.id),
    key: r.key as string,
    source: r.source as string,
    externalId: r.external_id as string,
    company: r.company as string,
    title: r.title as string,
    location: r.location as string | null,
    remote: r.remote as boolean | null,
    url: r.url as string,
    applyUrl: r.apply_url as string | null,
    description: r.description as string,
    flags: r.flags as GuardFlags,
    salary: r.salary as Posting['salary'],
    ats: r.ats as Posting['ats'],
    postedAt: iso(r.posted_at),
    foundAt: iso(r.found_at)!,
    lastSeenAt: iso(r.last_seen_at)!,
    gate: r.gate as string | null,
    score: r.score as number | null,
    scoreDetail: r.score_detail,
    scoreError: r.score_error as string | null,
    scoredAt: iso(r.scored_at),
    status: r.status as PostingStatus,
    notes: r.notes as string,
    cv: r.cv,
    cvStyle: r.cv_style as string | null,
    cvPdfUrl: r.cv_pdf_url as string | null,
    letter: r.letter as string | null,
    answers: r.answers,
    draftState: r.draft_state as DraftState,
    draftIssues: r.draft_issues,
    draftRunId: r.draft_run_id as string | null,
  };
}

type Patch = Partial<
  Pick<
    Posting,
    | 'status'
    | 'notes'
    | 'cv'
    | 'cvStyle'
    | 'cvPdfUrl'
    | 'letter'
    | 'answers'
    | 'draftState'
    | 'draftIssues'
    | 'draftRunId'
    | 'gate'
    | 'score'
    | 'scoreDetail'
    | 'scoreError'
    | 'description'
  >
>;

/** Sets the given fields (`undefined` leaves a column alone, `null` clears it). Patching `score` or `scoreError` also stamps `scored_at`. */
export async function updatePosting(sql: Sql, id: number, patch: Patch): Promise<void> {
  const has = (k: keyof Patch) => patch[k] !== undefined;
  const j = (k: keyof Patch) => (patch[k] == null ? null : JSON.stringify(patch[k]));
  await sql`
    update career_postings set
      status = case when ${has('status')} then ${patch.status ?? null}::text else status end,
      notes = case when ${has('notes')} then ${patch.notes ?? null}::text else notes end,
      cv = case when ${has('cv')} then ${j('cv')}::jsonb else cv end,
      cv_style = case when ${has('cvStyle')} then ${patch.cvStyle ?? null}::text else cv_style end,
      cv_pdf_url = case when ${has('cvPdfUrl')} then ${patch.cvPdfUrl ?? null}::text else cv_pdf_url end,
      letter = case when ${has('letter')} then ${patch.letter ?? null}::text else letter end,
      answers = case when ${has('answers')} then ${j('answers')}::jsonb else answers end,
      draft_state = case when ${has('draftState')} then ${patch.draftState ?? null}::text else draft_state end,
      draft_issues = case when ${has('draftIssues')} then ${j('draftIssues')}::jsonb else draft_issues end,
      draft_run_id = case when ${has('draftRunId')} then ${patch.draftRunId ?? null}::text else draft_run_id end,
      gate = case when ${has('gate')} then ${patch.gate ?? null}::text else gate end,
      score = case when ${has('score')} then ${patch.score ?? null}::int else score end,
      score_detail = case when ${has('scoreDetail')} then ${j('scoreDetail')}::jsonb else score_detail end,
      score_error = case when ${has('scoreError')} then ${patch.scoreError ?? null}::text else score_error end,
      description = case when ${has('description')} then ${patch.description ?? null}::text else description end,
      scored_at = case when ${has('score') || has('scoreError')} then now() else scored_at end
    where id = ${id}`;
}

export async function addEvent(sql: Sql, postingId: number, kind: string, detail?: string): Promise<void> {
  await sql`insert into career_events (posting_id, kind, detail) values (${postingId}, ${kind}, ${detail ?? null})`;
}

export async function listEvents(
  sql: Sql,
  postingId: number,
): Promise<{ at: string; kind: string; detail: string | null }[]> {
  const rows =
    await sql<Row>`select at, kind, detail from career_events where posting_id = ${postingId} order by id desc`;
  return rows.map((r) => ({ at: iso(r.at)!, kind: r.kind as string, detail: r.detail as string | null }));
}

export async function readCareer(
  sql: Sql,
): Promise<{ prefs: unknown; answers: unknown; lastRun: RunSummary | null; runId: string | null }> {
  const [r] = await sql<Row>`select prefs, answers, last_run, run_id from career_settings where id = 1`;
  return {
    prefs: r?.prefs ?? {},
    answers: r?.answers ?? {},
    lastRun: (r?.last_run as RunSummary | null) ?? null,
    runId: (r?.run_id as string | null) ?? null,
  };
}

/** Upserts the single settings row; only the given fields change. */
export async function writeCareer(
  sql: Sql,
  patch: Partial<{ prefs: unknown; answers: unknown; lastRun: RunSummary; runId: string | null }>,
  by: string,
): Promise<void> {
  const has = (k: keyof typeof patch) => k in patch;
  const j = (v: unknown) => JSON.stringify(v);
  await sql`
    insert into career_settings (id, prefs, answers, last_run, run_id, updated_by)
    values (1, ${j(patch.prefs ?? {})}::jsonb, ${j(patch.answers ?? {})}::jsonb,
      ${patch.lastRun ? j(patch.lastRun) : null}::jsonb, ${patch.runId ?? null}, ${by})
    on conflict (id) do update set
      prefs = case when ${has('prefs')} then excluded.prefs else career_settings.prefs end,
      answers = case when ${has('answers')} then excluded.answers else career_settings.answers end,
      last_run = case when ${has('lastRun')} then excluded.last_run else career_settings.last_run end,
      run_id = case when ${has('runId')} then excluded.run_id else career_settings.run_id end,
      updated_at = now(), updated_by = ${by}`;
}
