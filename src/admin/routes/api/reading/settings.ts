import { json, readBody } from '../../../../lib/admin/http';
import { getSecret } from '../../../../lib/admin/secrets';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { readReading, writeReading } from '../../../../lib/reading/db';
import { parseReadingPrefs, validateReadingPrefs } from '../../../../lib/reading/settings';

export const prerender = false;

/** The prefs as stored, and whether each key the digest can use is set (never a value). */
async function current() {
  const sql = getSql();
  const [{ prefs }, openalex, resend] = await Promise.all([
    readReading(sql),
    getSecret(sql, 'OPENALEX_API_KEY'),
    getSecret(sql, 'RESEND_API_KEY'),
  ]);
  return json({ prefs: parseReadingPrefs(prefs), keys: { OPENALEX_API_KEY: !!openalex, RESEND_API_KEY: !!resend } });
}

export const GET = careerRoute(current);

/** `{ prefs }`: validated (a bad field is a field error) and saved; returns the same shape as GET. */
export const PUT = careerRoute(async (ctx, _store, user) => {
  const { prefs } = await readBody<{ prefs?: unknown }>(ctx);
  await writeReading(getSql(), { prefs: validateReadingPrefs(prefs) }, user.login);
  return current();
});
