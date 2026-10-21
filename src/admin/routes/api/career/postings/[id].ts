import { z } from 'astro/zod';
import { readConfig } from '../../../../../lib/admin/content';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { addEvent, getPosting, listEvents, updatePosting } from '../../../../../lib/career/db';
import { careerRoute } from '../../../../../lib/career/route';
import { assembleCv, FabricationError } from '../../../../../lib/career/tailor';
import type { PostingStatus } from '../../../../../lib/career/types';
import { getSql } from '../../../../../lib/db';
import type { CvConfig } from '../../../../../lib/types';

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

const Plan = z.strictObject({
  sections: z
    .array(
      z.strictObject({
        title: z.string().max(200),
        entries: z
          .array(
            z.strictObject({
              ref: z.number().int().min(0),
              highlights: z.array(z.string().max(2000)).max(50).optional(),
              text: z.string().max(2000).optional(),
            }),
          )
          .max(200),
      }),
    )
    .max(50),
});

// Task 14 adds answers here.
const Patch = z.strictObject({
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(20_000).optional(),
  cv: Plan.optional(),
  letter: z.string().max(20_000).optional(),
});

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

/**
 * `{ status?, notes?, cv?, letter? }`: each change that differs from the stored value is saved and logged as an event.
 * The owner may reword `cv` freely, but it still goes through assembleCv: only the CV's own sections and entries, and
 * no more highlights than an entry has.
 */
export const PATCH = careerRoute(async (ctx, store) => {
  const posting = await load(ctx.params.id);
  const body = Patch.parse(await readBody(ctx));
  const sql = getSql();
  if (body.cv !== undefined && JSON.stringify(body.cv) !== JSON.stringify(posting.cv)) {
    const base = (await readConfig(store, 'cv')).data as unknown as CvConfig;
    if (!base.cv?.sections) throw new HttpError(400, 'There is no CV to tailor: add one on the CV screen');
    try {
      assembleCv(base, body.cv);
    } catch (e) {
      if (e instanceof FabricationError) throw new HttpError(400, e.message);
      throw e;
    }
    await updatePosting(sql, posting.id, { cv: body.cv });
    await addEvent(sql, posting.id, 'cv edited');
  }
  if (body.letter !== undefined && body.letter !== posting.letter) {
    await updatePosting(sql, posting.id, { letter: body.letter });
    await addEvent(sql, posting.id, 'letter edited');
  }
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
