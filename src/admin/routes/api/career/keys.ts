import { HttpError, json, readBody } from '../../../../lib/admin/http';
import {
  assertSecretName,
  CAREER_SECRETS,
  listSecrets,
  setSecret,
  type SecretName,
} from '../../../../lib/admin/secrets';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';

export const prerender = false;

const NAMES: SecretName[] = [...CAREER_SECRETS, 'SERPAPI_KEY'];

/** Each job-source key's source (admin, environment, unset); never a value. */
export const GET = careerRoute(async () => json(await listSecrets(getSql(), NAMES)));

/** `{ name, value }`: a value is stored encrypted; null or '' clears it. */
export const PUT = careerRoute(async (ctx, _store, user) => {
  const { name, value = null } = await readBody<{ name?: unknown; value?: unknown }>(ctx);
  if (value !== null && typeof value !== 'string') throw new HttpError(400, '`value` must be a string or null');
  const secret = assertSecretName(name);
  if (!NAMES.includes(secret)) throw new HttpError(400, `Unknown key "${secret}"`);
  await setSecret(getSql(), secret, value, user.login);
  return json(await listSecrets(getSql(), NAMES));
});
