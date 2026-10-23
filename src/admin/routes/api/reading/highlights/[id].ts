import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { idParam } from '../../../../../lib/reading/library';
import { deleteHighlight, setHighlightComment } from '../../../../../lib/reading/room-db';

export const prerender = false;

const Body = z.strictObject({ comment: z.string().max(2000) });

/** `{ comment }` → `{ comment }`. */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const { comment } = Body.parse(await readBody(ctx));
  if (!(await setHighlightComment(getSql(), id, comment))) throw new HttpError(404, 'Not found');
  return json({ comment });
});

export const DELETE = careerRoute(async (ctx) => {
  if (!(await deleteHighlight(getSql(), idParam(ctx.params.id)))) throw new HttpError(404, 'Not found');
  return new Response(null, { status: 204 });
});
