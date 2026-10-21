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

type RunStatus = (runId: string) => Promise<string>;

/** Starts the nightly run unless the last one is still pending or running. `runStatus` is for tests. */
export async function startNightly(
  sql: Sql,
  runStatus: RunStatus = (runId) => getRun(runId).status,
): Promise<{ runId: string } | { running: string }> {
  const { runId } = await readCareer(sql);
  // A run the world no longer knows (expired, or local data cleared) is not running.
  const status = runId ? await runStatus(runId).catch(() => null) : null;
  if (runId && (status === 'running' || status === 'pending')) return { running: runId };
  // ponytail: two starts in the same instant can both start a run (the cron and Run now); a conditional update on run_id closes it if that ever matters.
  const run = await start(careerNightly);
  await writeCareer(sql, { runId: run.runId }, 'ScholarOS jobs');
  return { runId: run.runId };
}
