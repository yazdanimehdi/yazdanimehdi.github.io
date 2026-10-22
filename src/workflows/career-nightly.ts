import { sleep } from 'workflow';
import { getRun, start } from 'workflow/api';
import type { Sql } from '../lib/db';
import { failPrefill, prefillStep } from '../lib/career/apply/steps';
import { readCareer, writeCareer } from '../lib/career/db';
import {
  claimDraft,
  digestStep,
  draftPlan,
  draftReady,
  enabledSources,
  finishRun,
  gatherSource,
  markScoreFailed,
  pendingScores,
  scorePosting,
  scoreReady,
} from '../lib/career/steps';
import type { RunSummary } from '../lib/career/types';
import { claimPrefillStep } from './career-apply';
import { draftPosting, reasonOf } from './career-draft';

const BATCH = 5;
/** How long a nightly pre-fill waits for the apply sandbox (a submit or a pre-fill the owner started) to free up. */
const BUSY_WAITS = 10;

/** A step failure's message without the Workflow SDK's wrapper (or its `cause`'s own), short enough to show. */
export function errorText(reason: unknown): string {
  const raw = reason && typeof reason === 'object' ? reasonOf(reason) : String(reason);
  return raw
    .replace(/^Step "[^"]*" failed:\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
    .slice(0, 300);
}

/**
 * The night, as far as `nightly.stage` goes: 1 gathers every enabled source in parallel; 2 scores what's new, five at
 * a time, up to the cap; 3 drafts tonight's candidates one at a time; 4 pre-fills each one that drafted cleanly. It
 * never submits. A failing draft or pre-fill (a quota, the provider) stops the rest and says why. The digest goes last.
 */
export async function careerNightly(): Promise<RunSummary> {
  'use workflow';
  const { sources, maxScores, stage, paused } = await enabledSources();
  if (paused) {
    const summary: RunSummary = {
      at: new Date().toISOString(),
      sources: [],
      scored: 0,
      failed: 0,
      deferred: 0,
      paused: true,
      stage,
    };
    await finishRun(summary);
    return summary;
  }
  const gathered = await Promise.all(
    sources.map((s) =>
      s.skipped
        ? { id: s.id, found: 0, added: 0, skipped: s.skipped }
        : gatherSource(s.id).catch(() => ({ id: s.id, found: 0, added: 0, error: 'unexpected error' })),
    ),
  );
  let deferred = 0;
  let scored = 0;
  let failed = 0;
  let scoreError: string | undefined;
  let scoreSkipped: string | null = null;
  if (stage >= 2) {
    const pending = await pendingScores(maxScores);
    deferred = pending.deferred;
    // A setup problem would fail every posting the same way: score nothing and say why.
    scoreSkipped = pending.ids.length ? await scoreReady().catch((e) => errorText(e)) : null;
    if (scoreSkipped) deferred += pending.ids.length;
    else {
      for (let i = 0; i < pending.ids.length; i += BATCH) {
        const batch = pending.ids.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map((id) => scorePosting(id)));
        for (const [j, r] of results.entries()) {
          // Rejected: the provider or the network failed. The posting stays pending and is tried again tomorrow.
          if (r.status === 'rejected') {
            deferred++;
            scoreError ??= errorText(r.reason);
          } else if (r.value === null) scored++;
          else {
            failed++;
            await markScoreFailed(batch[j], r.value);
          }
        }
      }
    }
  }

  const drafted: number[] = [];
  const clean: number[] = [];
  let limited = 0;
  let stopped: string | undefined;
  if (stage >= 3) {
    const plan = await draftPlan();
    limited = plan.limited;
    stopped = (plan.drafts.length && (await draftReady())) || undefined;
    for (const { id, greenhouse } of stopped ? [] : plan.drafts) {
      if (!(await claimDraft(id))) continue;
      try {
        const state = await draftPosting(id, 'all', '', greenhouse);
        if (state === 'done' || state === 'needs-review') drafted.push(id);
        if (state === 'done') clean.push(id);
      } catch (e) {
        stopped = errorText(e);
        break;
      }
    }
  }

  let prefilled = 0;
  let handedOff = 0;
  if (stage >= 4) {
    for (const id of stopped ? [] : clean) {
      let claim = await claimPrefillStep(id);
      for (let wait = 0; claim === 'busy' && wait < BUSY_WAITS; wait++) {
        await sleep('1m');
        claim = await claimPrefillStep(id);
      }
      if (claim !== 'ok') continue;
      try {
        const app = await prefillStep(id);
        if (app?.state === 'ready') prefilled++;
        else if (app?.state === 'handoff') handedOff++;
      } catch (e) {
        await failPrefill(id, reasonOf(e));
        stopped = errorText(e);
        break;
      }
    }
  }

  const summary: RunSummary = {
    at: new Date().toISOString(),
    sources: gathered,
    scored,
    failed,
    deferred,
    ...(scoreSkipped ? { scoreSkipped } : {}),
    ...(scoreError ? { scoreError } : {}),
    stage,
    drafted: drafted.length,
    prefilled,
    handedOff,
    limited,
    ...(stopped ? { stopped } : {}),
  };
  summary.digest = await digestStep(summary, drafted);
  await finishRun(summary);
  return summary;
}

/** A run older than this that still says pending or running is stuck (a nightly run takes minutes). */
const STALE_MS = 6 * 60 * 60 * 1000;

/** The slice of the Workflow API startNightly uses; tests pass their own. */
export interface Runs {
  get(runId: string): { status: Promise<string>; createdAt: Promise<Date>; cancel(): Promise<void> };
  start(): Promise<{ runId: string }>;
}
const workflowRuns: Runs = { get: getRun, start: () => start(careerNightly) };
let testRuns: Runs | null = null;

/** Tests swap the Workflow API; production code never calls this. */
export function setRunsForTests(runs: Runs | null): void {
  testRuns = runs;
}

/** Starts the nightly run unless the last one is still pending or running; one stuck that way for 6 hours is cancelled. */
export async function startNightly(
  sql: Sql,
  runs: Runs = testRuns ?? workflowRuns,
  now = Date.now(),
): Promise<{ runId: string } | { running: string }> {
  const { runId } = await readCareer(sql);
  if (runId) {
    const run = runs.get(runId);
    // A run the world no longer knows (expired, or local data cleared) is not running.
    const status = await run.status.catch(() => null);
    if (status === 'running' || status === 'pending') {
      // A run of unknown age counts as stale.
      if (now - (await run.createdAt.catch(() => new Date(0))).getTime() < STALE_MS) return { running: runId };
      // A failed cancel must not block every later night: the new run starts anyway.
      // eslint-disable-next-line no-console
      await run.cancel().catch((e) => console.error('[career] cancelling a stale run', e));
    }
  }
  // ponytail: two starts in the same instant can both start a run (the cron and Run now); a conditional update on run_id closes it if that ever matters.
  const { runId: started } = await runs.start();
  await writeCareer(sql, { runId: started }, 'ScholarOS jobs');
  return { runId: started };
}
