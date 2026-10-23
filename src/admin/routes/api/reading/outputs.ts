import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { TARGET, targetOf } from '../../../../lib/reading/library';
import { startRoomRun } from '../../../../workflows/reading-room';

export const prerender = false;

const Body = z.strictObject({ ...TARGET, kind: z.enum(['summary', 'briefing', 'faq', 'glossary']) });

/** `{ paper | notebook, kind }` → `{ runId }`: writes (or rewrites) the summary or a study aid in the background. */
export const POST = careerRoute(async (ctx) => {
  const { kind, ...target } = Body.parse(await readBody(ctx));
  const started = await startRoomRun(getSql(), targetOf(target), kind);
  if (!started) throw new HttpError(404, 'Not found');
  if (started === 'running') throw new HttpError(409, 'Already being written');
  if (started === 'empty') throw new HttpError(400, 'Add a paper to this notebook first');
  return json(started);
});
