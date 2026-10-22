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
import { claimPrefillStep, ensureQueueStep } from './career-apply';
import { draftPosting, reasonOf } from './career-draft';
import { errorText, startUnlessRunning, type Runs } from './runs';

const BATCH = 5;
/** How long a nightly pre-fill waits for the apply sandbox (a submit or a pre-fill the owner started) to free up. */
const BUSY_WAITS = 10;

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
    // Pausing stops the nightly automation, not the owner's own approvals.
    await ensureQueueStep();
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
  // An approval whose queue never started (it failed to, or died) is picked up here.
  await ensureQueueStep();
  summary.digest = await digestStep(summary, drafted);
  await finishRun(summary);
  return summary;
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
  return startUnlessRunning(runs, runId, (id) => writeCareer(sql, { runId: id }, 'ScholarOS jobs'), now);
}
