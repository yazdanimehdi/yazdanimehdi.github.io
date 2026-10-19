import { deleteAccount, resetPassword, withAccounts } from '../../../../lib/admin/accounts';
import { json, postgresOnly, readBody, route } from '../../../../lib/admin/http';
import { getSql } from '../../../../lib/db';

export const prerender = false;

/** Reset someone's password: their sessions end; they sign in with the new one. */
export const PUT = route(async (ctx, store) => {
  postgresOnly(store);
  const { password } = await readBody<{ password?: unknown }>(ctx);
  await withAccounts(() => resetPassword(getSql(), String(ctx.params.username), password));
  return json({ ok: true });
});

export const DELETE = route(async (ctx, store, user) => {
  postgresOnly(store);
  await withAccounts(() => deleteAccount(getSql(), String(ctx.params.username), user));
  return json({ ok: true });
});
