import { json, route } from '../../../../lib/admin/http';

export const prerender = false;

/**
 * The commit this deployment was built from (Vercel's system variable), so the screen can tell when a publish is live.
 * null off Vercel; behind Skew Protection or on a preview URL it never changes, and the screen keeps "about a minute".
 */
export const GET = route(async () => json({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null }));
