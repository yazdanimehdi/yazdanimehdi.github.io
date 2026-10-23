import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { idParam } from '../../../../../lib/reading/library';
import { deleteHighlight, setHighlightComment, setHighlightPublic } from '../../../../../lib/reading/room-db';
import { afterVaultWrite } from '../../../../../lib/reading/visibility';

export const prerender = false;

const Body = z
  .strictObject({ comment: z.string().max(2000).optional(), public: z.boolean().optional() })
  .refine((b) => b.comment !== undefined || b.public !== undefined, 'Give a comment or public');

/** `{ comment?, public? }` → the same, with `publishWarning?`. A refused toggle writes nothing. */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const body = Body.parse(await readBody(ctx));
  const sql = getSql();
  if (body.public !== undefined) {
    const set = await setHighlightPublic(sql, id, body.public);
    if (set === 'full') throw new HttpError(409, 'A paper shares at most 10 highlights.');
    if (!set) throw new HttpError(404, 'Not found');
  }
  if (body.comment !== undefined && !(await setHighlightComment(sql, id, body.comment)))
    throw new HttpError(404, 'Not found');
  return json({ ...body, ...(await afterVaultWrite(sql)) });
});

/** 204, or `{ publishWarning }` when the public copies couldn't be updated. */
export const DELETE = careerRoute(async (ctx) => {
  const sql = getSql();
  if (!(await deleteHighlight(sql, idParam(ctx.params.id)))) throw new HttpError(404, 'Not found');
  const warning = await afterVaultWrite(sql);
  return warning.publishWarning ? json(warning) : new Response(null, { status: 204 });
});
