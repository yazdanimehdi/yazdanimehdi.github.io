import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../../lib/admin/http';
import { updatePosting } from '../../../../../../lib/career/db';
import { careerRoute } from '../../../../../../lib/career/route';
import { getSql } from '../../../../../../lib/db';
import { startDraftRun } from '../../../../../../workflows/career-draft';

export const prerender = false;

const Body = z.strictObject({
  part: z.enum(['all', 'cv', 'letter', 'render']).default('all'),
  instruction: z.string().max(500).default(''),
});

/** `{ part?, instruction? }` → `{ runId }`; 409 while a draft of this posting is running. */
export const POST = careerRoute(async (ctx) => {
  const id = /^\d{1,9}$/.test(ctx.params.id ?? '') ? Number(ctx.params.id) : NaN;
  if (Number.isNaN(id)) throw new HttpError(404, 'Not found');
  const { part, instruction } = Body.parse(await readBody(ctx));
  const sql = getSql();
  // One conditional update, so two clicks can't both start a draft.
  // ponytail: a run that dies without reaching failDraft leaves 'running' for good; a started_at column would let a stale one restart.
  const [claimed] = await sql`update career_postings set draft_state = 'running'
    where id = ${id} and draft_state <> 'running' returning id`;
  if (!claimed) {
    const [exists] = await sql`select 1 from career_postings where id = ${id}`;
    throw exists ? new HttpError(409, 'A draft of this posting is already running') : new HttpError(404, 'Not found');
  }
  let runId: string;
  try {
    ({ runId } = await startDraftRun(id, part, instruction));
  } catch (e) {
    await updatePosting(sql, id, { draftState: 'failed' });
    throw e;
  }
  await updatePosting(sql, id, { draftRunId: runId });
  return json({ runId });
});
