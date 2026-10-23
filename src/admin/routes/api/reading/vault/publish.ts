import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { getPapers } from '../../../../../lib/reading/db';
import type { VaultNote } from '../../../../../lib/reading/types';
import { ensurePaperNote, roomNote, setNotePublic, withTitles } from '../../../../../lib/reading/vault-db';
import { afterVaultWrite, noteVisibility, publishAgain } from '../../../../../lib/reading/visibility';

export const prerender = false;

const Body = z.union([z.strictObject({ paper: z.number().int().positive(), public: z.boolean() }), z.strictObject({})]);

/**
 * `{ paper, public }` → `{ visibility, publishWarning? }`: the room's toggle, which gives the paper its note when it
 * has none. `{}` → `{ changed }`: Publish again, a 502 with the sentence when it fails.
 */
export const POST = careerRoute(async (ctx) => {
  const body = Body.parse(await readBody(ctx));
  const sql = getSql();
  if (!('paper' in body)) return json(await publishAgain(sql));
  if (!(await getPapers(sql, [body.paper])).length) throw new HttpError(404, 'Not found');
  const { id } = body.public
    ? await withTitles(sql, (tx) => ensurePaperNote(tx, body.paper))
    : await roomNote(sql, { paper: body.paper });
  // A paper's note is never a chat note.
  const note = id == null ? null : ((await setNotePublic(sql, id, body.public)) as VaultNote | null);
  const warning = await afterVaultWrite(sql);
  return json({ visibility: await noteVisibility(sql, note, body.paper), ...warning });
});
