import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { idParam } from '../../../../../lib/reading/library';
import { setChatSaved } from '../../../../../lib/reading/room-db';
import { dropChatNote, ensureChatNote, withTitles } from '../../../../../lib/reading/vault-db';

export const prerender = false;

const Body = z.strictObject({ saved: z.boolean() });

/**
 * `{ saved }`: keeps an answer as a vault note (or takes it out) → `{ saved }`. Questions can't be saved. Unsaving is
 * refused while the note holds the owner's writing.
 */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const { saved } = Body.parse(await readBody(ctx));
  const sql = getSql();
  const [m] = await sql<{ role: string }>`select role from reading_chats where id = ${id}`;
  if (!m) throw new HttpError(404, 'Not found');
  if (m.role !== 'assistant') throw new HttpError(400, 'Only answers can be saved');
  const done = await withTitles(sql, async (tx) => {
    if (saved) await ensureChatNote(tx, id);
    else if ((await dropChatNote(tx, id)) === 'written') return false;
    return setChatSaved(tx, id, saved);
  });
  if (!done)
    throw new HttpError(409, 'This answer’s vault note has your writing in it. Delete the note in the vault instead.');
  return json({ saved });
});
