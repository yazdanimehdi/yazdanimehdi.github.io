import { z } from 'astro/zod';
import { json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { suggestLinks } from '../../../../../lib/reading/vault-suggest';

export const prerender = false;

const Body = z.strictObject({ note: z.number().int().min(1).max(999_999_999) });

/** `{ note }` → `{ suggestions }`: a fresh AI run replacing the note's open suggestions (one room AI call). */
export const POST = careerRoute(async (ctx, store) => {
  const { note } = Body.parse(await readBody(ctx));
  return json({ suggestions: await suggestLinks(getSql(), store, note) });
});
