import { HttpError, json } from '../../../../lib/admin/http';
import { listPostings } from '../../../../lib/career/db';
import { careerRoute } from '../../../../lib/career/route';
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

/** The feed: ranked postings, optionally one `?status=`. */
export const GET = careerRoute(async (ctx) => {
  const status = ctx.url.searchParams.get('status');
  if (status && !STATUSES.has(status)) throw new HttpError(400, `Unknown status "${status}"`);
  return json(await listPostings(getSql(), { status: (status as PostingStatus | null) ?? undefined }));
});
