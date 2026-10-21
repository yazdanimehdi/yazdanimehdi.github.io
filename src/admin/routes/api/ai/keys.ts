import { HttpError, json, postgresOnly, readBody, route } from '../../../../lib/admin/http';
import {
  assertSecretName,
  CAREER_SECRETS,
  listSecrets,
  SECRETS,
  type SecretName,
  secretsDb,
  setSecret,
} from '../../../../lib/admin/secrets';
import { getSql } from '../../../../lib/db';

export const prerender = false;

const AI_SECRETS = (Object.keys(SECRETS) as SecretName[]).filter((n) => !CAREER_SECRETS.includes(n));

/** Each key's source (admin, environment, unset); never a value. */
export const GET = route(async (_ctx, store) => json(await listSecrets(secretsDb(store), AI_SECRETS)));

/** `{ name, value }`: a value is stored encrypted; null or '' clears it. Postgres mode only (git mode has no database). */
export const PUT = route(async (ctx, store, user) => {
  postgresOnly(store);
  const { name, value = null } = await readBody<{ name?: unknown; value?: unknown }>(ctx);
  if (value !== null && typeof value !== 'string') throw new HttpError(400, '`value` must be a string or null');
  const secret = assertSecretName(name);
  if (CAREER_SECRETS.includes(secret)) throw new HttpError(400, `Unknown key "${secret}"`);
  await setSecret(getSql(), secret, value, user.login);
  return json(await listSecrets(getSql(), AI_SECRETS));
});
