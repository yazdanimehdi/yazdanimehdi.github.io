// What the nightly workflows share: a step failure's message, and starting a run unless the last one is still going.
import { reasonOf } from './career-draft';

/** A step failure's message without the Workflow SDK's wrapper (or its `cause`'s own), short enough to show. */
export function errorText(reason: unknown): string {
  const raw = reason && typeof reason === 'object' ? reasonOf(reason) : String(reason);
  return raw
    .replace(/^Step "[^"]*" failed:\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
    .slice(0, 300);
}

/** A run older than this that still says pending or running is stuck (a nightly run takes minutes). */
const STALE_MS = 6 * 60 * 60 * 1000;

/** The slice of the Workflow API a nightly start uses; tests pass their own. */
export interface Runs {
  get(runId: string): { status: Promise<string>; createdAt: Promise<Date>; cancel(): Promise<void> };
  start(): Promise<{ runId: string }>;
}

/**
 * Starts a run unless `runId` (the last one) is still pending or running; one stuck that way for 6 hours is
 * cancelled. `save` records the new run's id.
 */
export async function startUnlessRunning(
  runs: Runs,
  runId: string | null,
  save: (runId: string) => Promise<void>,
  now = Date.now(),
): Promise<{ runId: string } | { running: string }> {
  if (runId) {
    const run = runs.get(runId);
    // A run the world no longer knows (expired, or local data cleared) is not running.
    const status = await run.status.catch(() => null);
    if (status === 'running' || status === 'pending') {
      // A run of unknown age counts as stale.
      if (now - (await run.createdAt.catch(() => new Date(0))).getTime() < STALE_MS) return { running: runId };
      // A failed cancel must not block every later night: the new run starts anyway.
      // eslint-disable-next-line no-console
      await run.cancel().catch((e) => console.error('[workflow] cancelling a stale run', e));
    }
  }
  // ponytail: two starts in the same instant can both start a run (the cron and Run now); a conditional update on run_id closes it if that ever matters.
  const { runId: started } = await runs.start();
  await save(started);
  return { runId: started };
}
