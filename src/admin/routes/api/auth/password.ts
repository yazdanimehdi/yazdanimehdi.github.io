import type { APIRoute } from 'astro';
import { MIGRATION_MESSAGE, MigrationMissingError, signIn } from '../../../../lib/admin/accounts';
import { json } from '../../../../lib/admin/http';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, sealSession, sessionSecret } from '../../../../lib/admin/session';
import { getSql, isUnreachable } from '../../../../lib/db';
import { getMode } from '../../../../lib/mode';

export const prerender = false;

/** The caller's address (Vercel sets it from the connection; a client can't forge it); '' where unavailable. */
function clientIp(ctx: { clientAddress?: string }): string {
  try {
    return ctx.clientAddress ?? '';
  } catch {
    return '';
  }
}

/** Username + password sign-in (Postgres mode). Same cookie as GitHub sign-in; the middleware re-checks the account on every request. */
export const POST: APIRoute = async (ctx) => {
  const { request, cookies } = ctx;
  if (getMode() !== 'postgres') return json({ error: 'Not found' }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request body must be JSON' }, 400);
  }
  const { username, password } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return json({ error: '`username` and `password` are required' }, 400);
  }
  try {
    const result = await signIn(getSql(), username, password, new Date(), clientIp(ctx));
    if (!result.ok) {
      return result.reason === 'throttled'
        ? json({ error: 'Too many attempts; try again in 15 minutes' }, 429)
        : json({ error: 'Wrong username or password' }, 401);
    }
    const { account } = result;
    cookies.set(
      SESSION_COOKIE,
      await sealSession(
        { login: account.username, name: account.name, avatar: '', provider: 'password', version: account.version },
        sessionSecret(),
      ),
      SESSION_COOKIE_OPTIONS,
    );
    return json({ ok: true });
  } catch (e) {
    if (e instanceof MigrationMissingError) return json({ error: MIGRATION_MESSAGE }, 503);
    if (isUnreachable(e)) return json({ error: 'The database is unreachable. Try again in a moment.' }, 503);
    throw e;
  }
};
