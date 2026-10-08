import { createAccount, listAccounts, withAccounts } from '../../../lib/admin/accounts';
import { json, postgresOnly, readBody, route } from '../../../lib/admin/http';
import { adminLogin, adminSettings } from '../../../lib/admin/settings';
import { getSql } from '../../../lib/db';

export const prerender = false;

export const GET = route(async (_ctx, store) => {
  postgresOnly(store);
  return json({
    accounts: await withAccounts(() => listAccounts(getSql())),
    githubAdmins: adminSettings().adminUsers.map(adminLogin),
  });
});

export const POST = route(async (ctx, store) => {
  postgresOnly(store);
  const { username, name, password } = await readBody<{ username?: unknown; name?: unknown; password?: unknown }>(ctx);
  return json(await withAccounts(() => createAccount(getSql(), username, name, password)), 201);
});
