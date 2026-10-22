import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { addHighlight, getPassages } from '../../../../lib/reading/room-db';

export const prerender = false;

const Offset = z.number().int().min(0);
const Body = z.strictObject({
  paper: z.number().int().min(1).max(999_999_999),
  pid: z.string().max(100),
  start: Offset,
  end: Offset,
  quote: z.string().min(1).max(2000),
  comment: z.string().max(2000).default(''),
});

/** `{ paper, pid, start, end, quote, comment? }` → `{ highlight }`: a span within one stored passage. */
export const POST = careerRoute(async (ctx) => {
  const { paper, pid, start, end, quote, comment } = Body.parse(await readBody(ctx));
  const sql = getSql();
  const passage = (await getPassages(sql, [paper])).find((p) => p.pid === pid);
  if (!passage || start >= end || end > passage.body.length)
    throw new HttpError(400, 'A highlight must lie within one passage of the paper');
  return json({ highlight: await addHighlight(sql, { paperId: paper, pid, start, end, quote, comment }) });
});
