import { z } from 'astro/zod';
import { json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { approveAll } from '../../../../workflows/career-apply';

export const prerender = false;

/** The postings the owner was shown, each with the `application.at` of the pre-fill it showed. */
const Body = z.strictObject({
  items: z.array(z.strictObject({ id: z.number().int().positive(), at: z.string().max(100) })).max(200),
});

/**
 * "Approve all ready" for exactly the listed pre-fills, each approved on its own → `{ approved: id[], skipped: { id,
 * reason }[], queued }`. One pre-filled again since, or no longer waiting, is skipped and left as it was.
 */
export const POST = careerRoute(async (ctx, _store, user) => {
  const { items } = Body.parse(await readBody(ctx));
  return json(await approveAll(getSql(), items, user.login));
});
