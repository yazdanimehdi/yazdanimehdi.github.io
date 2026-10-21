import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../../lib/admin/http';
import { careerRoute } from '../../../../../../lib/career/route';
import { getSql } from '../../../../../../lib/db';
import { startDraftRun } from '../../../../../../workflows/career-draft';

export const prerender = false;

const Body = z.strictObject({
  part: z.enum(['all', 'cv', 'letter', 'render']).default('all'),
  instruction: z.string().max(500).default(''),
});

/** `{ part?, instruction? }` → `{ runId }`; 409 while a draft of this posting is running (a stale one restarts). */
export const POST = careerRoute(async (ctx) => {
  const id = /^\d{1,9}$/.test(ctx.params.id ?? '') ? Number(ctx.params.id) : NaN;
  if (Number.isNaN(id)) throw new HttpError(404, 'Not found');
  const { part, instruction } = Body.parse(await readBody(ctx));
  const started = await startDraftRun(getSql(), id, part, instruction);
  if (!started) throw new HttpError(404, 'Not found');
  if (started === 'running') throw new HttpError(409, 'A draft of this posting is already running');
  return json(started);
});
