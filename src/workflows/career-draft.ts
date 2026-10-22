import { getRun, start } from 'workflow/api';
import { WorkflowRunNotFoundError } from 'workflow/errors';
import type { Sql } from '../lib/db';
import { CLAIM, updatePosting } from '../lib/career/db';
import {
  answersStep,
  draftStep,
  failDraft,
  finishDraft,
  noteAnswersFailed,
  renderStep,
  reviewStep,
  draftReady,
  startDraft,
} from '../lib/career/steps';
import type { DraftPart, ReviewIssue } from '../lib/career/tailor';
import type { DraftState } from '../lib/career/types';

/** A step's own message: past its retries the SDK wraps the original error as `cause` (no classes cross over). */
export function reasonOf(e: unknown): string {
  const err = e as { message?: unknown; cause?: { message?: unknown } } | null;
  return String(err?.cause?.message ?? err?.message ?? 'unexpected error');
}

/**
 * A tailored CV and cover letter for one posting: draft, review, one revision when the review finds issues, then
 * render. `render` skips the AI (the owner edited the plan); `letter` doesn't re-render. `answers` proposes answers to the
 * Greenhouse form only; `all` adds them for a Greenhouse posting (`greenhouse`, set by the caller from the row).
 * Returns the draft state it ended in. A failing step (the provider, the network, an exhausted quota) fails the draft
 * with its reason and is rethrown, so the nightly run can stop. A plain function, not a workflow: careerDraft and
 * careerNightly both call it inside their own run.
 */
export async function draftPosting(
  id: number,
  part: DraftPart,
  instruction: string,
  greenhouse = false,
): Promise<DraftState> {
  const fail = async (reason: string) => {
    await failDraft(id, reason);
    return 'failed' as const;
  };
  try {
    await startDraft(id, part);
    if (part === 'answers') {
      const failed = (await draftReady()) ?? (await answersStep(id, instruction));
      if (failed) return await fail(failed);
      return await finishDraft(id, null, part);
    }
    let review: { ok: boolean; issues: ReviewIssue[] } | null = null;
    if (part !== 'render') {
      const failed = (await draftReady()) ?? (await draftStep(id, part, instruction, null));
      if (failed) return await fail(failed);
      review = await reviewStep(id, part);
      if (!review.ok) {
        const again = await draftStep(id, part, instruction, review.issues);
        if (again) return await fail(again);
        review = await reviewStep(id, part);
      }
    }
    if (part !== 'letter') {
      const failed = await renderStep(id);
      if (failed) return await fail(failed);
    }
    // Form answers never fail the CV draft: a problem is recorded and `answers` is left as it was.
    if (greenhouse && part === 'all') {
      try {
        const failed = await answersStep(id, instruction);
        if (failed) await noteAnswersFailed(id, failed);
      } catch (e) {
        await noteAnswersFailed(id, reasonOf(e));
      }
    }
    return await finishDraft(id, review, part);
  } catch (e) {
    await failDraft(id, reasonOf(e));
    throw e;
  }
}

/** One draft started from the job page; its outcome, a failure included, is recorded on the posting. */
export async function careerDraft(id: number, part: DraftPart, instruction: string, greenhouse = false): Promise<void> {
  'use workflow';
  await draftPosting(id, part, instruction, greenhouse).catch(() => undefined);
}

/** A draft run older than this that still says pending or running is stuck (a draft takes minutes). */
const STALE_MS = 60 * 60 * 1000;

/** The slice of the Workflow API startDraftRun uses; tests pass their own. */
export interface DraftRuns {
  get(runId: string): { status: Promise<string>; createdAt: Promise<Date>; cancel(): Promise<void> };
  start(id: number, part: DraftPart, instruction: string, greenhouse: boolean): Promise<{ runId: string }>;
}
const workflowRuns: DraftRuns = { get: getRun, start: (...args) => start(careerDraft, args) };
let testRuns: DraftRuns | null = null;

/** Tests swap the Workflow API; production code never calls this. */
export function setDraftRunsForTests(runs: DraftRuns | null): void {
  testRuns = runs;
}

/**
 * Whether a run id read from a row (never from a request) no longer runs: unknown, ended, or older than `staleMs` (a
 * stale run is cancelled). A `starting:<ms>` claim counts as running until it is that old.
 */
export async function finished(
  runId: string | null,
  runs: Pick<DraftRuns, 'get'>,
  now: number,
  staleMs = STALE_MS,
): Promise<boolean> {
  if (!runId) return true;
  if (runId.startsWith(CLAIM)) return now - Number(runId.slice(CLAIM.length)) > staleMs;
  const run = runs.get(runId);
  let status: string;
  try {
    status = await run.status;
  } catch (e) {
    // A run the world no longer knows (expired, or local data cleared) is not running; any other error might be.
    return WorkflowRunNotFoundError.is(e);
  }
  if (status !== 'running' && status !== 'pending') return true;
  if (now - (await run.createdAt.catch(() => new Date(0))).getTime() < staleMs) return false;
  try {
    await run.cancel();
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[career] cancelling a stale run', e);
    return false;
  }
}

/**
 * Starts a draft of the posting unless one is running: `{ runId }`, `'running'`, `'no-form'` for `answers` on a posting
 * without a Greenhouse form, or null when there is no such posting. A run that finished, can't be found, or started over an hour ago without ending doesn't block a new one.
 */
export async function startDraftRun(
  sql: Sql,
  id: number,
  part: DraftPart,
  instruction: string,
  runs: DraftRuns = testRuns ?? workflowRuns,
  now = Date.now(),
): Promise<{ runId: string } | 'running' | 'no-form' | null> {
  const [row] = await sql<{ draft_state: string; draft_run_id: string | null; ats: { kind?: string } | null }>`
    select draft_state, draft_run_id, ats from career_postings where id = ${id}`;
  if (!row) return null;
  const greenhouse = row.ats?.kind === 'greenhouse';
  if (part === 'answers' && !greenhouse) return 'no-form';
  if (row.draft_state === 'running' && !(await finished(row.draft_run_id, runs, now))) return 'running';
  // One conditional update, so two clicks can't both start a draft: the second no longer finds the row it read.
  const [claimed] = await sql`update career_postings set draft_state = 'running', draft_run_id = ${CLAIM + now}
    where id = ${id} and draft_state = ${row.draft_state} and draft_run_id is not distinct from ${row.draft_run_id}
    returning id`;
  if (!claimed) return 'running';
  let runId: string;
  try {
    ({ runId } = await runs.start(id, part, instruction, greenhouse));
  } catch (e) {
    await updatePosting(sql, id, { draftState: 'failed', draftRunId: null });
    throw e;
  }
  await updatePosting(sql, id, { draftRunId: runId });
  return { runId };
}
