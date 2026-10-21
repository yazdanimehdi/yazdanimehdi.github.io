import { json, readBody } from '../../../../lib/admin/http';
import { readCareer, writeCareer } from '../../../../lib/career/db';
import { careerRoute } from '../../../../lib/career/route';
import { parseAnswers, parsePrefs, validateAnswers, validatePrefs } from '../../../../lib/career/settings';
import { getSql } from '../../../../lib/db';

export const prerender = false;

async function current() {
  const { prefs, answers } = await readCareer(getSql());
  return json({ prefs: parsePrefs(prefs), answers: parseAnswers(answers) });
}

export const GET = careerRoute(current);

/** `{ prefs?, answers? }`: each part present is validated and saved; returns both as stored. */
export const PUT = careerRoute(async (ctx, _store, user) => {
  const body = await readBody<{ prefs?: unknown; answers?: unknown }>(ctx);
  const patch: Parameters<typeof writeCareer>[1] = {};
  if (body.prefs !== undefined) patch.prefs = validatePrefs(body.prefs);
  if (body.answers !== undefined) patch.answers = validateAnswers(body.answers);
  if (Object.keys(patch).length) await writeCareer(getSql(), patch, user.login);
  return current();
});
