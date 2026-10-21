import type { APIContext, APIRoute } from 'astro';
import { HttpError, route } from '../admin/http';
import { PostgresStore } from '../admin/postgres-store';
import type { SessionUser } from '../admin/session';
import { adminSettings, isOwner } from '../admin/settings';

/** A job-search route: Postgres mode and the owner only; anyone else gets the same 404 as a missing page. */
export function careerRoute(
  handler: (ctx: APIContext, store: PostgresStore, user: SessionUser) => Promise<Response>,
): APIRoute {
  return route(async (ctx, store, user) => {
    if (!(store instanceof PostgresStore) || !isOwner(user, adminSettings())) throw new HttpError(404, 'Not found');
    return handler(ctx, store, user);
  });
}
