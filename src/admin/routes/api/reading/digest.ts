import { HttpError, json } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { listDigests } from '../../../../lib/reading/db';

export const prerender = false;

/** `?before=YYYY-MM-DD&days=7`: the latest `days` (1..30) digests before that day, newest first → `{ days }`. */
export const GET = careerRoute(async (ctx) => {
  const params = ctx.url.searchParams;
  const before = params.get('before') ?? undefined;
  // A real calendar day: 2026-02-30 would pass a pattern and then fail in Postgres.
  const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d).toISOString().slice(0, 10) === d;
  if (before !== undefined && !isDay(before)) throw new HttpError(400, '`before` must be YYYY-MM-DD');
  const days = Number(params.get('days') ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new HttpError(400, '`days` must be 1 to 30');
  return json({ days: await listDigests(getSql(), { before, days }) });
});
