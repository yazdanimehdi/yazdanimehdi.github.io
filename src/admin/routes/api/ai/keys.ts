import { HttpError, json, postgresOnly, readBody, route } from '../../../../lib/admin/http';
import { assertSecretName, listSecrets, secretsDb, setSecret } from '../../../../lib/admin/secrets';
import { getSql } from '../../../../lib/db';

export const prerender = false;

/** Each key's source (admin, environment, unset); never a value. */
export const GET = route(async (_ctx, store) => json(await listSecrets(secretsDb(store))));

/** `{ name, value }`: a value is stored encrypted; null or '' clears it. Postgres mode only (git mode has no database). */
export const PUT = route(async (ctx, store, user) => {
  postgresOnly(store);
  const { name, value = null } = await readBody<{ name?: unknown; value?: unknown }>(ctx);
  if (value !== null && typeof value !== 'string') throw new HttpError(400, '`value` must be a string or null');
  await setSecret(getSql(), assertSecretName(name), value, user.login);
  return json(await listSecrets(getSql()));
});
