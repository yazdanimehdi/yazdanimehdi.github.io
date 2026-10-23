import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../../lib/admin/http';
import { careerRoute } from '../../../../../../lib/career/route';
import { getSql } from '../../../../../../lib/db';
import { idParam } from '../../../../../../lib/reading/library';
import { answerSuggestion } from '../../../../../../lib/reading/vault-suggest';
import { afterVaultWrite } from '../../../../../../lib/reading/visibility';

export const prerender = false;

const Body = z.strictObject({ accept: z.boolean() });

/** `{ accept }` → `{ note, publishWarning? }`: the note with its new body (an accepted link is on its Related line). */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const { accept } = Body.parse(await readBody(ctx));
  const sql = getSql();
  const note = await answerSuggestion(sql, id, accept);
  if (!note) throw new HttpError(404, 'Not found');
  return json({ note, ...(accept && (await afterVaultWrite(sql))) });
});
