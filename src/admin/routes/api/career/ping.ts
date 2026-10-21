import { getRun, start } from 'workflow/api';
import { HttpError, json, postgresOnly, route } from '../../../../lib/admin/http';
import { pingWorkflow } from '../../../../workflows/ping';

export const prerender = false;

/** Starts the ping workflow; returns its run id. */
export const POST = route(async (_ctx, store) => {
  postgresOnly(store);
  const run = await start(pingWorkflow, [21]);
  return json({ runId: run.runId });
});

/** `?runId=`: the run's status, and its value once completed. */
export const GET = route(async (ctx, store) => {
  postgresOnly(store);
  const runId = ctx.url.searchParams.get('runId');
  if (!runId) throw new HttpError(400, 'runId is required');
  const run = getRun<{ doubled: number }>(runId);
  const status = await run.status;
  return json(status === 'completed' ? { status, value: await run.returnValue } : { status });
});
