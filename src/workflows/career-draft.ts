import { getRun, start } from 'workflow/api';
import type { Sql } from '../lib/db';
import { updatePosting } from '../lib/career/db';
import { draftStep, failDraft, finishDraft, renderStep, reviewStep, scoreReady, startDraft } from '../lib/career/steps';
import type { DraftPart, ReviewIssue } from '../lib/career/tailor';

/** A step's own message: past its retries the SDK wraps the original error as `cause` (no classes cross over). */
function reasonOf(e: unknown): string {
  const err = e as { message?: unknown; cause?: { message?: unknown } } | null;
  return String(err?.cause?.message ?? err?.message ?? 'unexpected error');
}

/**
 * A tailored CV and cover letter for one posting: draft, review, one revision when the review finds issues, then
 * render. `render` skips the AI (the owner edited the plan); `letter` doesn't re-render.
 */
export async function careerDraft(id: number, part: DraftPart, instruction: string): Promise<void> {
  'use workflow';
  try {
    await startDraft(id, part);
    let review: { ok: boolean; issues: ReviewIssue[] } | null = null;
    if (part !== 'render') {
      const failed = (await scoreReady()) ?? (await draftStep(id, part, instruction, null));
      if (failed) return await failDraft(id, failed);
      review = await reviewStep(id);
      if (!review.ok) {
        const again = await draftStep(id, part, instruction, review.issues);
        if (again) return await failDraft(id, again);
        review = await reviewStep(id);
      }
    }
    if (part !== 'letter') {
      const failed = await renderStep(id);
      if (failed) return await failDraft(id, failed);
    }
    await finishDraft(id, review);
  } catch (e) {
    await failDraft(id, reasonOf(e));
  }
}

/** A draft run older than this that still says pending or running is stuck (a draft takes minutes). */
const STALE_MS = 60 * 60 * 1000;
/** Set while `start()` is in flight, so a second click sees a draft starting, not a finished run. */
const CLAIM = 'starting:';

/** The slice of the Workflow API startDraftRun uses; tests pass their own. */
export interface DraftRuns {
  get(runId: string): { status: Promise<string>; createdAt: Promise<Date>; cancel(): Promise<void> };
  start(id: number, part: DraftPart, instruction: string): Promise<{ runId: string }>;
}
const workflowRuns: DraftRuns = { get: getRun, start: (...args) => start(careerDraft, args) };
let testRuns: DraftRuns | null = null;

/** Tests swap the Workflow API; production code never calls this. */
export function setDraftRunsForTests(runs: DraftRuns | null): void {
  testRuns = runs;
}

/** Whether a posting's `draft_run_id` (read from its row, never from a request) is no longer drafting. */
async function finished(runId: string | null, runs: DraftRuns, now: number): Promise<boolean> {
  if (!runId) return true;
  if (runId.startsWith(CLAIM)) return now - Number(runId.slice(CLAIM.length)) > STALE_MS;
  const run = runs.get(runId);
  // A run the world no longer knows (expired, or local data cleared) is not running.
  const status = await run.status.catch(() => null);
  if (status !== 'running' && status !== 'pending') return true;
  if (now - (await run.createdAt.catch(() => new Date(0))).getTime() < STALE_MS) return false;
  // eslint-disable-next-line no-console
  await run.cancel().catch((e) => console.error('[career] cancelling a stale draft', e));
  return true;
}

/**
 * Starts a draft of the posting unless one is running: `{ runId }`, `'running'`, or null when there is no such
 * posting. A run that finished, can't be found, or started over an hour ago without ending doesn't block a new one.
 */
export async function startDraftRun(
  sql: Sql,
  id: number,
  part: DraftPart,
  instruction: string,
  runs: DraftRuns = testRuns ?? workflowRuns,
  now = Date.now(),
): Promise<{ runId: string } | 'running' | null> {
  const [row] = await sql<{ draft_state: string; draft_run_id: string | null }>`
    select draft_state, draft_run_id from career_postings where id = ${id}`;
  if (!row) return null;
  if (row.draft_state === 'running' && !(await finished(row.draft_run_id, runs, now))) return 'running';
  // One conditional update, so two clicks can't both start a draft: the second no longer finds the row it read.
  const [claimed] = await sql`update career_postings set draft_state = 'running', draft_run_id = ${CLAIM + now}
    where id = ${id} and draft_state = ${row.draft_state} and draft_run_id is not distinct from ${row.draft_run_id}
    returning id`;
  if (!claimed) return 'running';
  let runId: string;
  try {
    ({ runId } = await runs.start(id, part, instruction));
  } catch (e) {
    await updatePosting(sql, id, { draftState: 'failed', draftRunId: null });
    throw e;
  }
  await updatePosting(sql, id, { draftRunId: runId });
  return { runId };
}
