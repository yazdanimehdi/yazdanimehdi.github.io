import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/admin/get-store';
import { GitHubStore } from '../../../lib/admin/github-store';
import { authorOf, json } from '../../../lib/admin/http';
import { adminSettings, isOwner } from '../../../lib/admin/settings';
import { UpstreamError } from '../../../lib/admin/store';
import { readyCount } from '../../../lib/career/db';
import { getSql } from '../../../lib/db';
import { getMode } from '../../../lib/mode';

export const prerender = false;

/**
 * The signed-in user, what the GitHub token can do (drives the admin's permission banner) and, for the job-search
 * owner in Postgres mode, how many postings wait for approval (the sidebar badge).
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Not signed in' }, 401);
  let capabilities: { contents: boolean; actions: boolean; error?: string } = { contents: true, actions: true };
  try {
    const store = getStore(authorOf(locals.user));
    if (store instanceof GitHubStore) capabilities = await store.capabilities();
  } catch (e) {
    // UpstreamError messages are written for the user; anything else stays in the logs.
    const upstream = e instanceof UpstreamError;
    // eslint-disable-next-line no-console
    if (!upstream) console.error(e);
    capabilities = {
      contents: false,
      actions: false,
      error: upstream ? e.message : 'Could not check the GitHub token',
    };
  }
  const owner = getMode() === 'postgres' && isOwner(locals.user, adminSettings());
  // A badge is never worth failing the request: an unreachable database leaves it out.
  const ready = owner ? await readyCount(getSql()).catch(() => null) : null;
  return json({ user: locals.user, capabilities, ...(ready === null ? {} : { career: { ready } }) });
};
