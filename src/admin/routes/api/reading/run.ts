import { getRun } from 'workflow/api';
import { json } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { readReading } from '../../../../lib/reading/db';
import { startReading } from '../../../../workflows/reading-nightly';

export const prerender = false;

/** Run now: `{ runId }`, or `{ running }` when the last run hasn't finished. */
export const POST = careerRoute(async () => json(await startReading(getSql())));

/** The latest run (its id only ever comes from reading_settings) and the last finished run's summary. */
export const GET = careerRoute(async () => {
  const { runId, lastRun } = await readReading(getSql());
  const status = runId ? await getRun(runId).status.catch(() => null) : null;
  return json({ runId, status, lastRun });
});
