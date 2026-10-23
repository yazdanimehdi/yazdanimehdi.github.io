import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { createNote, listNotes } from '../../../../../lib/reading/vault-db';
import { noteTitle } from '../../../../../lib/reading/vault-links';

export const prerender = false;

const Query = z.object({ q: z.string().max(200).optional(), kind: z.enum(['paper', 'chat', 'free']).optional() });
const Body = z.strictObject({ title: z.string().trim().min(1).max(200) });

/** `?q=&kind=` → `{ notes }`: every note matching, title matches first. */
export const GET = careerRoute(async (ctx) => {
  const query = Query.parse(Object.fromEntries(ctx.url.searchParams));
  return json({ notes: await listNotes(getSql(), query) });
});

/** `{ title }` → `{ id }`: a free note with exactly that (cleaned) title. */
export const POST = careerRoute(async (ctx) => {
  const { title } = Body.parse(await readBody(ctx));
  const note = await createNote(getSql(), title);
  if (note === 'taken') throw new HttpError(409, `A note called “${noteTitle(title)}” already exists`);
  return json({ id: note.id });
});
