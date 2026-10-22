import type { Sql, Tx } from '../db';
import type { Application, ApplyState } from './apply/types';
import type {
  DraftState,
  Feed,
  GuardFlags,
  Posting,
  PostingStatus,
  PostingSummary,
  RawPosting,
  RunSummary,
} from './types';

/** A run id while `start()` is in flight (or a nightly run holds the posting), so a second click sees it starting. */
export const CLAIM = 'starting:';

// JSON goes in as `${text}::text::jsonb`: with a bare `::jsonb`, postgres.js sees a jsonb parameter and encodes the
// string again, storing a jsonb string instead of the object (PGlite doesn't, so only a real Postgres shows it).
type Row = Record<string, unknown>;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());

/**
 * Inserts postings it has not seen (by `key`), with their hard-gate reason; a posting seen again only gets
 * `last_seen_at` bumped. Returns how many were inserted. A row that fails to store is skipped (and logged), not the
 * rest of the batch.
 */
export async function upsertPostings(
  sql: Sql,
  rows: (RawPosting & { key: string; text: string; flags: GuardFlags; gate?: string | null })[],
): Promise<number> {
  let added = 0;
  for (const r of rows) {
    let out;
    try {
      out = await sql<{ inserted: boolean }>`
      insert into career_postings (key, source, external_id, company, title, location, remote, url, apply_url,
        description, flags, salary, ats, posted_at, gate)
      values (${r.key}, ${r.source}, ${r.externalId}, ${r.company}, ${r.title}, ${r.location ?? null}, ${r.remote ?? null},
        ${r.url}, ${r.applyUrl ?? null}, ${r.text}, ${JSON.stringify(r.flags)}::text::jsonb,
        ${r.salary ? JSON.stringify(r.salary) : null}::text::jsonb, ${r.ats ? JSON.stringify(r.ats) : null}::text::jsonb,
        ${r.postedAt ?? null}, ${r.gate ?? null})
      on conflict (key) do update set last_seen_at = clock_timestamp()
      returning (xmax = 0) as inserted`;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[career] could not store a ${r.source} posting`, (e as Error).message);
      continue;
    }
    if (out[0]?.inserted) added++;
  }
  return added;
}

const summary = (r: Row): PostingSummary => ({
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
});

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
  return rows.map(summary);
}

/**
 * The feed, grouped in SQL so every heading's count is true however many rows there are: matches are scored at or
 * over the threshold and ungated, the rest stay visible in their own groups. Each group returns its best `perGroup`.
 * `open` leaves out the statuses the owner has closed (skipped, rejected, withdrawn).
 */
export async function feedPostings(
  sql: Sql,
  f: { status?: PostingStatus | 'open'; threshold: number; perGroup?: number },
): Promise<Feed> {
  const status = f.status ?? null;
  const rows = await sql<Row>`
    select * from (
      select g.*, row_number() over (partition by grp order by score desc nulls last, found_at desc) as n,
        count(*) over (partition by grp) as total
      from (
        select id, company, title, location, remote, score, gate, status, found_at, flags, draft_state,
          case when gate is not null then 'gated' when score is null then 'unscored'
            when score >= ${f.threshold}::numeric then 'matches' else 'below' end as grp
        from career_postings
        where ${status}::text is null or status = ${status}
          or (${status}::text = 'open' and status not in ('skipped', 'rejected', 'withdrawn'))
      ) g
    ) r
    where n <= ${f.perGroup ?? 200}
    order by n`;
  const feed: Feed = {
    matches: { rows: [], total: 0 },
    below: { rows: [], total: 0 },
    gated: { rows: [], total: 0 },
    unscored: { rows: [], total: 0 },
  };
  for (const r of rows) {
    const g = feed[r.grp as keyof Feed];
    g.rows.push(summary(r));
    g.total = Number(r.total);
  }
  return feed;
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
    application: r.application as Application | null,
    applyRunId: r.apply_run_id as string | null,
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
    | 'application'
    | 'applyRunId'
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
      cv = case when ${has('cv')} then ${j('cv')}::text::jsonb else cv end,
      cv_style = case when ${has('cvStyle')} then ${patch.cvStyle ?? null}::text else cv_style end,
      cv_pdf_url = case when ${has('cvPdfUrl')} then ${patch.cvPdfUrl ?? null}::text else cv_pdf_url end,
      letter = case when ${has('letter')} then ${patch.letter ?? null}::text else letter end,
      answers = case when ${has('answers')} then ${j('answers')}::text::jsonb else answers end,
      draft_state = case when ${has('draftState')} then ${patch.draftState ?? null}::text else draft_state end,
      draft_issues = case when ${has('draftIssues')} then ${j('draftIssues')}::text::jsonb else draft_issues end,
      draft_run_id = case when ${has('draftRunId')} then ${patch.draftRunId ?? null}::text else draft_run_id end,
      gate = case when ${has('gate')} then ${patch.gate ?? null}::text else gate end,
      score = case when ${has('score')} then ${patch.score ?? null}::int else score end,
      score_detail = case when ${has('scoreDetail')} then ${j('scoreDetail')}::text::jsonb else score_detail end,
      score_error = case when ${has('scoreError')} then ${patch.scoreError ?? null}::text else score_error end,
      description = case when ${has('description')} then ${patch.description ?? null}::text else description end,
      application = case when ${has('application')} then ${j('application')}::text::jsonb else application end,
      apply_run_id = case when ${has('applyRunId')} then ${patch.applyRunId ?? null}::text else apply_run_id end,
      scored_at = case when ${has('score') || has('scoreError')} then now() else scored_at end
    where id = ${id}`;
}

/** Postings with status ready, the latest pre-fill first; `waiting`: only those whose application awaits approval. */
export async function readyPostings(sql: Sql, waiting = false): Promise<PostingSummary[]> {
  const rows = await sql<Row>`
    select id, company, title, location, remote, score, gate, status, found_at, flags, draft_state
    from career_postings where status = 'ready' and (not ${waiting} or application->>'state' = 'ready')
    order by application->>'at' desc nulls last, found_at desc`;
  return rows.map(summary);
}

/** How many applications wait for the owner's approval: the badge, the tab count and the dashboard. */
export async function readyCount(sql: Sql): Promise<number> {
  const [r] = await sql<{ n: number }>`select count(*)::int as n from career_postings
    where status = 'ready' and application->>'state' = 'ready'`;
  return Number(r.n);
}

/** Ids of approved applications in the order they were approved, for the submit queue. */
export async function approvedPostings(sql: Sql): Promise<number[]> {
  const rows = await sql<Row>`
    select id from career_postings where application->>'state' = 'approved'
    order by application->'approved'->>'at' asc nulls last, id`;
  return rows.map((r) => Number(r.id));
}

/**
 * Replaces the application only if it is still in state `from` (and, given `at`, from that very pre-fill): the one
 * guard every apply transition goes through, so two actors can't both move it. `status` moves the posting too, but only
 * from `found`, `drafted` or `ready`: a status the owner set meanwhile (skipped, interview…) stands. Returns the
 * posting's status before and after the move, or null when the application had already moved on.
 */
export async function moveApplication(
  sql: Sql,
  id: number,
  from: { state: ApplyState | null; at?: string },
  app: Application,
  status?: PostingStatus,
): Promise<{ was: PostingStatus; now: PostingStatus } | null> {
  const [r] = await sql<{ was: PostingStatus; now: PostingStatus }>`
    update career_postings p set application = ${JSON.stringify(app)}::text::jsonb,
      status = case when p.status in ('found', 'drafted', 'ready') then coalesce(${status ?? null}::text, p.status)
        else p.status end
    from (select id, status as old from career_postings where id = ${id}) o
    where p.id = o.id and p.application->>'state' is not distinct from ${from.state}
      and (${from.at ?? null}::text is null or p.application->>'at' = ${from.at ?? null})
    returning o.old as was, p.status as now`;
  return r ?? null;
}

/** Who holds the apply sandbox: the posting and the `at` of the application it claimed. */
export interface ApplyLock {
  postingId: number;
  kind: 'prefill' | 'submit';
  at: string;
}

/** A lock older than this is stale: its run died without letting go (one takes a few minutes, a step at most 5). */
const LOCK_STALE = '15 minutes';

/** Thrown inside a claim's transaction to roll the lock back when the posting had moved on. */
class Unclaimed extends Error {}

/**
 * Takes the apply lock and runs `claim` (the posting's own conditional UPDATE) in one transaction, so both happen or
 * neither. The lock is free when empty, stale, or already this posting's (one posting has one actor at a time: its
 * claim says so). Returns `busy` while another run holds it, what `claim` returned, or null when the posting had moved
 * on (the lock is then left as it was).
 */
export async function claimWithLock<T>(
  sql: Sql,
  lock: ApplyLock,
  claim: (tx: Tx) => Promise<T | undefined>,
): Promise<T | 'busy' | null> {
  await sql`insert into career_settings (id) values (1) on conflict (id) do nothing`;
  try {
    return await sql.begin(async (tx) => {
      const [held] = await tx`update career_settings set apply_lock = ${JSON.stringify(lock)}::text::jsonb
        where id = 1 and (apply_lock is null
          or (apply_lock->>'at')::timestamptz < now() - ${LOCK_STALE}::interval
          or apply_lock->>'postingId' = ${String(lock.postingId)})
        returning id`;
      if (!held) return 'busy' as const;
      const out = await claim(tx);
      if (out === undefined) throw new Unclaimed();
      return out;
    });
  } catch (e) {
    if (e instanceof Unclaimed) return null;
    throw e;
  }
}

/**
 * Lets go of the apply lock if this run (`postingId`, `at`) still holds it, running `then` (stopping the VM) before
 * anyone else can take it. A run whose stale lock was taken over lets go of nothing and leaves the VM to the new
 * holder.
 */
export async function releaseApplyLock(
  sql: Sql,
  postingId: number,
  at: string,
  then: () => Promise<void>,
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [held] = await tx`update career_settings set apply_lock = null
      where id = 1 and apply_lock->>'postingId' = ${String(postingId)} and apply_lock->>'at' = ${at}
      returning id`;
    if (held) await then();
    return !!held;
  });
}

/** Whether a run for another posting holds the apply sandbox (one apply run at a time). */
export async function applyBusy(sql: Sql, exceptId: number | null = null): Promise<boolean> {
  const [r] = await sql`
    select 1 from career_settings
    where id = 1 and apply_lock is not null
      and (apply_lock->>'at')::timestamptz >= now() - ${LOCK_STALE}::interval
      and apply_lock->>'postingId' is distinct from ${exceptId === null ? null : String(exceptId)}::text`;
  return !!r;
}

/**
 * Applications to `company` (case-insensitive, trimmed) that count against the per-company limit: drafted or further
 * along, and found or moved to a status on or after `sinceIso`.
 */
export async function companyApplications(sql: Sql, company: string, sinceIso: string): Promise<number> {
  const [r] = await sql<{ n: number }>`
    select count(*)::int as n from career_postings p
    where lower(trim(p.company)) = lower(trim(${company}))
      and p.status in ('drafted', 'ready', 'submitted', 'interview', 'offer')
      and (p.found_at >= ${sinceIso}::timestamptz or exists (
        select 1 from career_events e
        where e.posting_id = p.id and e.kind = 'status' and e.at >= ${sinceIso}::timestamptz))`;
  return r.n;
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

export async function readCareer(sql: Sql): Promise<{
  prefs: unknown;
  answers: unknown;
  lastRun: RunSummary | null;
  runId: string | null;
  applyQueueRunId: string | null;
}> {
  const [r] =
    await sql<Row>`select prefs, answers, last_run, run_id, apply_queue_run_id from career_settings where id = 1`;
  return {
    prefs: r?.prefs ?? {},
    answers: r?.answers ?? {},
    lastRun: (r?.last_run as RunSummary | null) ?? null,
    runId: (r?.run_id as string | null) ?? null,
    applyQueueRunId: (r?.apply_queue_run_id as string | null) ?? null,
  };
}

/** Upserts the single settings row; only the given fields change. */
export async function writeCareer(
  sql: Sql,
  patch: Partial<{
    prefs: unknown;
    answers: unknown;
    lastRun: RunSummary;
    runId: string | null;
    applyQueueRunId: string | null;
  }>,
  by: string,
): Promise<void> {
  const has = (k: keyof typeof patch) => k in patch;
  const j = (v: unknown) => JSON.stringify(v);
  await sql`
    insert into career_settings (id, prefs, answers, last_run, run_id, apply_queue_run_id, updated_by)
    values (1, ${j(patch.prefs ?? {})}::text::jsonb, ${j(patch.answers ?? {})}::text::jsonb,
      ${patch.lastRun ? j(patch.lastRun) : null}::text::jsonb, ${patch.runId ?? null},
      ${patch.applyQueueRunId ?? null}, ${by})
    on conflict (id) do update set
      prefs = case when ${has('prefs')} then excluded.prefs else career_settings.prefs end,
      answers = case when ${has('answers')} then excluded.answers else career_settings.answers end,
      last_run = case when ${has('lastRun')} then excluded.last_run else career_settings.last_run end,
      run_id = case when ${has('runId')} then excluded.run_id else career_settings.run_id end,
      apply_queue_run_id = case when ${has('applyQueueRunId')} then excluded.apply_queue_run_id
        else career_settings.apply_queue_run_id end,
      updated_at = now(), updated_by = ${by}`;
}
