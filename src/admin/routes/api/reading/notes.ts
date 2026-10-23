import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { getPapers } from '../../../../lib/reading/db';
import { TARGET, targetOf } from '../../../../lib/reading/library';
import { getNotebook } from '../../../../lib/reading/room-db';
import { saveRoomNote, withTitles } from '../../../../lib/reading/vault-db';

export const prerender = false;

const Body = z.strictObject({ ...TARGET, body: z.string().max(20_000) });

/** `{ paper | notebook, body }` → `{ body }`: the paper's (or notebook's) vault note; a blank body creates none. */
export const PUT = careerRoute(async (ctx) => {
  const { body, ...ids } = Body.parse(await readBody(ctx));
  const target = targetOf(ids);
  const sql = getSql();
  const exists =
    'paper' in target ? (await getPapers(sql, [target.paper])).length : await getNotebook(sql, target.notebook);
  if (!exists) throw new HttpError(404, 'Not found');
  await withTitles(sql, (tx) => saveRoomNote(tx, target, body));
  return json({ body });
});
