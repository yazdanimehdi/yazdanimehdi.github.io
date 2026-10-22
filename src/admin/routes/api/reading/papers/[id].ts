import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { setPaperState } from '../../../../../lib/reading/db';
import type { PaperState } from '../../../../../lib/reading/types';

export const prerender = false;

const STATES = new Set<string>(['new', 'saved', 'dismissed'] satisfies PaperState[]);

/** `{ state }`: save, dismiss or reset a paper → `{ state }`. */
export const PATCH = careerRoute(async (ctx) => {
  const id = Number(ctx.params.id);
  const { state } = await readBody<{ state?: unknown }>(ctx);
  if (typeof state !== 'string' || !STATES.has(state))
    throw new HttpError(400, '`state` must be new, saved or dismissed');
  if (!Number.isSafeInteger(id) || id < 1 || !(await setPaperState(getSql(), id, state as PaperState)))
    throw new HttpError(404, 'Not found');
  return json({ state });
});
