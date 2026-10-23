import { z } from 'astro/zod';
import { json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { createNotebook, listNotebooks } from '../../../../lib/reading/room-db';

export const prerender = false;

const Body = z.strictObject({ title: z.string().trim().min(1).max(200) });

/** Notebooks, most recently changed first. */
export const GET = careerRoute(async () => json({ notebooks: await listNotebooks(getSql()) }));

/** `{ title }` → `{ id }`. */
export const POST = careerRoute(async (ctx) => {
  const { title } = Body.parse(await readBody(ctx));
  return json({ id: await createNotebook(getSql(), title) });
});
