import { json, postgresOnly, route } from '../../../../lib/admin/http';
import { dailySteps, runJobs } from '../../../../lib/admin/jobs';
import { adminSettings, isOwner } from '../../../../lib/admin/settings';

export const prerender = false;

/** The dashboard's "Run now": the daily jobs, as the signed-in user. Only the owner's starts the job search and digest. */
export const POST = route(async (_ctx, store, user) => {
  const pg = postgresOnly(store);
  // Anyone else's run still answers 'done' for career and reading, so the response doesn't tell either exists.
  const none = isOwner(user, adminSettings()) ? undefined : async () => ({ running: '' });
  return json(await runJobs(pg, dailySteps(pg, none, none)));
});
