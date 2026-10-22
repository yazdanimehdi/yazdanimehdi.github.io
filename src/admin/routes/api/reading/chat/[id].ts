import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { idParam } from '../../../../../lib/reading/library';
import { setChatSaved } from '../../../../../lib/reading/room-db';

export const prerender = false;

const Body = z.strictObject({ saved: z.boolean() });

/** `{ saved }`: keeps an answer in the notes (or takes it out) → `{ saved }`. Questions can't be saved. */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const { saved } = Body.parse(await readBody(ctx));
  const sql = getSql();
  const [m] = await sql<{ role: string }>`select role from reading_chats where id = ${id}`;
  if (!m) throw new HttpError(404, 'Not found');
  if (m.role !== 'assistant') throw new HttpError(400, 'Only answers can be saved');
  await setChatSaved(sql, id, saved);
  return json({ saved });
});
