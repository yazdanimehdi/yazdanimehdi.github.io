import { changeOwnPassword, withAccounts } from '../../../../lib/admin/accounts';
import { HttpError, json, postgresOnly, readBody, route } from '../../../../lib/admin/http';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, sealSession, sessionSecret } from '../../../../lib/admin/session';
import { getSql } from '../../../../lib/db';

export const prerender = false;

/** Change your own password: other devices sign out, this one gets a fresh cookie with the new version. */
export const POST = route(async (ctx, store, user) => {
  postgresOnly(store);
  if (user.provider !== 'password') throw new HttpError(404, 'Only password accounts have a password here');
  const { current, next } = await readBody<{ current?: unknown; next?: unknown }>(ctx);
  const version = await withAccounts(() => changeOwnPassword(getSql(), user.login, current, next));
  ctx.cookies.set(SESSION_COOKIE, await sealSession({ ...user, version }, sessionSecret()), SESSION_COOKIE_OPTIONS);
  return json({ ok: true });
});
