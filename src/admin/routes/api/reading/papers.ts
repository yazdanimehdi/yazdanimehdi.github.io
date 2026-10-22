import { z } from 'astro/zod';
import { json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { addPaper, fetchMissingTexts } from '../../../../lib/reading/library';
import { listSaved } from '../../../../lib/reading/room-db';

export const prerender = false;

const Body = z.strictObject({ ref: z.string().max(300) });

/** The library: saved papers, most recently saved first. */
export const GET = careerRoute(async () => json({ papers: await listSaved(getSql()) }));

/** `{ ref }` (an arXiv id or DOI) → `{ id, added }`; the paper is saved and its text fetched. */
export const POST = careerRoute(async (ctx, store) => {
  const { ref } = Body.parse(await readBody(ctx));
  const sql = getSql();
  const saved = await addPaper(sql, store, ref);
  await fetchMissingTexts(sql, { paper: saved.id }, [saved.id]);
  return json(saved);
});
