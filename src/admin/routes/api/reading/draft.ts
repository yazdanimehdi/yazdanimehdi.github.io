import { z } from 'astro/zod';
import { json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { draftPost } from '../../../../lib/reading/blog-draft';
import { Id } from '../../../../lib/reading/library';
import { DRAFT_MAX_PAPERS } from '../../../../lib/reading/limits';

export const prerender = false;

const Body = z.union([
  z.strictObject({ paper: Id }),
  z.strictObject({ notebook: Id }),
  z.strictObject({ note: Id }),
  z.strictObject({ papers: z.array(Id).min(1).max(DRAFT_MAX_PAPERS) }),
]);

/** Exactly one of `{ paper | notebook | note | papers }` → `{ slug }` of the unpublished post drafted from it. */
export const POST = careerRoute(async (ctx, store) =>
  json(await draftPost(getSql(), store, Body.parse(await readBody(ctx)))),
);
