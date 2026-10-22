import { json } from '../../../../lib/admin/http';
import { getPosting, readyPostings } from '../../../../lib/career/db';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import type { ReadyRow } from '../../../career';

export const prerender = false;

/** The Ready for approval list: each posting with its pre-fill's time, field count and state. */
export const GET = careerRoute(async () => {
  const sql = getSql();
  // ponytail: one read per ready posting; a handful a night (nightly.maxDrafts), a joined query if that grows.
  const rows = await Promise.all(
    (await readyPostings(sql)).map(async (r): Promise<ReadyRow> => {
      const app = (await getPosting(sql, r.id))?.application;
      return { ...r, prefilledAt: app?.at ?? null, fields: app?.fields.length ?? 0, state: app?.state ?? null };
    }),
  );
  return json({ rows });
});
