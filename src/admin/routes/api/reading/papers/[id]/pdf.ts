import { HttpError, json } from '../../../../../../lib/admin/http';
import { careerRoute } from '../../../../../../lib/career/route';
import { getSql } from '../../../../../../lib/db';
import { getPapers } from '../../../../../../lib/reading/db';
import { storeUpload } from '../../../../../../lib/reading/fetch-text';
import { idParam } from '../../../../../../lib/reading/library';
import { deleteOutputs, readText } from '../../../../../../lib/reading/room-db';

export const prerender = false;

const MAX = 4 * 1024 * 1024;
const TOO_BIG = 'PDFs up to 4 MB can be uploaded';

/**
 * The owner's PDF (raw body) as the paper's text, for a paper with only its abstract, a scan, no text or a failed
 * fetch → `{ text }`. Its summary and study aids are cleared: they were written from the old text.
 */
export const POST = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  if (Number(ctx.request.headers.get('content-length') ?? 0) > MAX) throw new HttpError(413, TOO_BIG);
  const sql = getSql();
  const [[paper], t] = await Promise.all([getPapers(sql, [id]), readText(sql, id)]);
  if (!paper) throw new HttpError(404, 'Not found');
  const bytes = new Uint8Array(await ctx.request.arrayBuffer());
  if (bytes.byteLength > MAX) throw new HttpError(413, TOO_BIG);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new HttpError(400, 'That file is not a PDF');
  if (t.source !== null && t.source !== 'abstract' && t.source !== 'scan' && !t.error)
    throw new HttpError(409, 'This paper already has its full text');
  const text = await storeUpload(sql, id, bytes);
  await deleteOutputs(sql, id);
  return json({ text });
});
