import { getRun } from 'workflow/api';
import { json } from '../../../../lib/admin/http';
import { readCareer } from '../../../../lib/career/db';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { startNightly } from '../../../../workflows/career-nightly';

export const prerender = false;

/** Run now: `{ runId }`, or `{ running }` when the last run hasn't finished. */
export const POST = careerRoute(async () => json(await startNightly(getSql())));

/** The latest run (its id only ever comes from career_settings) and the last finished run's summary. */
export const GET = careerRoute(async () => {
  const { runId, lastRun } = await readCareer(getSql());
  const status = runId ? await getRun(runId).status.catch(() => null) : null;
  return json({ runId, status, lastRun });
});
