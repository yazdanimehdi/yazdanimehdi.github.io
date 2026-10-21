import { HttpError, json } from '../../../../lib/admin/http';
import { feedPostings, readCareer } from '../../../../lib/career/db';
import { careerRoute } from '../../../../lib/career/route';
import { parsePrefs } from '../../../../lib/career/settings';
import type { PostingStatus } from '../../../../lib/career/types';
import { getSql } from '../../../../lib/db';

export const prerender = false;

const STATUSES = new Set<string>([
  'found',
  'skipped',
  'drafted',
  'ready',
  'submitted',
  'interview',
  'offer',
  'rejected',
  'no-response',
  'withdrawn',
] satisfies PostingStatus[]);

/** The feed, grouped against the owner's threshold; `?status=` is one status, or `open` for every status not closed. */
export const GET = careerRoute(async (ctx) => {
  const status = ctx.url.searchParams.get('status');
  if (status && status !== 'open' && !STATUSES.has(status)) throw new HttpError(400, `Unknown status "${status}"`);
  const sql = getSql();
  const { threshold } = parsePrefs((await readCareer(sql)).prefs);
  return json(await feedPostings(sql, { status: (status as PostingStatus | 'open' | null) ?? undefined, threshold }));
});
