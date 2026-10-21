import { getRun, start } from 'workflow/api';
import type { Sql } from '../lib/db';
import { readCareer, writeCareer } from '../lib/career/db';
import {
  enabledSources,
  finishRun,
  gatherSource,
  markScoreFailed,
  pendingScores,
  scorePosting,
} from '../lib/career/steps';
import type { RunSummary } from '../lib/career/types';

const BATCH = 5;

/** The step's own message: a step out of retries rejects with the SDK's wrapper, the original as `cause`. */
function messageOf(reason: unknown): string {
  const e = (reason as { cause?: unknown } | null)?.cause ?? reason;
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(e);
}

/** Gather every enabled source in parallel, then score what's new, five at a time, up to the nightly cap. */
export async function careerNightly(): Promise<RunSummary> {
  'use workflow';
  const { sources, maxScores } = await enabledSources();
  const gathered = await Promise.all(
    sources.map((s) => (s.skipped ? { id: s.id, found: 0, added: 0, skipped: s.skipped } : gatherSource(s.id))),
  );
  const { ids, deferred } = await pendingScores(maxScores);
  let scored = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((id) => scorePosting(id)));
    for (const [j, r] of results.entries()) {
      if (r.status === 'fulfilled') scored++;
      else {
        failed++;
        await markScoreFailed(batch[j], messageOf(r.reason));
      }
    }
  }
  const summary: RunSummary = { at: new Date().toISOString(), sources: gathered, scored, failed, deferred };
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

/** Starts the nightly run unless the last one is still pending or running; one stuck that way for 6 hours is cancelled. */
export async function startNightly(
  sql: Sql,
  runs: Runs = workflowRuns,
  now = Date.now(),
): Promise<{ runId: string } | { running: string }> {
  const { runId } = await readCareer(sql);
  if (runId) {
    const run = runs.get(runId);
    // A run the world no longer knows (expired, or local data cleared) is not running.
    const status = await run.status.catch(() => null);
    if (status === 'running' || status === 'pending') {
      if (now - (await run.createdAt).getTime() < STALE_MS) return { running: runId };
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
