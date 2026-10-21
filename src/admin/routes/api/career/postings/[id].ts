import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { addEvent, getPosting, listEvents, updatePosting } from '../../../../../lib/career/db';
import { careerRoute } from '../../../../../lib/career/route';
import type { PostingStatus } from '../../../../../lib/career/types';
import { getSql } from '../../../../../lib/db';

export const prerender = false;

const STATUSES = [
  'found',
  'skipped',
  'drafted',
  'ready',
  'submitted',
  'interview',
  'offer',
  'rejected',
  'no-response',
  'withdrawn',
] as const satisfies readonly PostingStatus[];

// Later tasks add letter, cv and answers here.
const Patch = z.strictObject({ status: z.enum(STATUSES).optional(), notes: z.string().max(20_000).optional() });

async function load(idParam: string | undefined) {
  const id = /^\d{1,9}$/.test(idParam ?? '') ? Number(idParam) : NaN;
  const posting = Number.isNaN(id) ? null : await getPosting(getSql(), id);
  if (!posting) throw new HttpError(404, 'Not found');
  return posting;
}

export const GET = careerRoute(async (ctx) => {
  const posting = await load(ctx.params.id);
  return json({ posting, events: await listEvents(getSql(), posting.id) });
});

/** `{ status?, notes? }`: each change that differs from the stored value is saved and logged as an event. */
export const PATCH = careerRoute(async (ctx) => {
  const posting = await load(ctx.params.id);
  const body = Patch.parse(await readBody(ctx));
  const sql = getSql();
  if (body.status !== undefined && body.status !== posting.status) {
    await updatePosting(sql, posting.id, { status: body.status });
    await addEvent(sql, posting.id, 'status', `${posting.status} → ${body.status}`);
  }
  if (body.notes !== undefined && body.notes !== posting.notes) {
    await updatePosting(sql, posting.id, { notes: body.notes });
    await addEvent(sql, posting.id, 'notes edited');
  }
  return json({ posting: await load(ctx.params.id), events: await listEvents(sql, posting.id) });
});
