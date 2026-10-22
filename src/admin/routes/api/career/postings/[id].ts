import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { addEvent, getPosting, listEvents, updatePosting } from '../../../../../lib/career/db';
import { careerRoute } from '../../../../../lib/career/route';
import { withdrawApproval } from '../../../../../workflows/career-apply';
import { baseCv, FabricationError, type TailorPlan, withCoverage } from '../../../../../lib/career/tailor';
import type { ContentStore } from '../../../../../lib/admin/store';
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
              details: z.string().max(2000).optional(),
            }),
          )
          .max(200),
      }),
    )
    .max(50),
  // The coverage fields may come back from the editor; they are recomputed on save.
  requirements: z
    .array(
      z.strictObject({
        term: z.string().min(1).max(80),
        kind: z.enum(['required', 'preferred']),
        evidence: z.string().max(200).nullable(),
        inCv: z.boolean().optional(),
        inBase: z.boolean().optional(),
        uses: z.number().optional(),
      }),
    )
    .max(15)
    .optional(),
});

const Answers = z
  .array(
    z.strictObject({
      question: z.string().max(2000),
      field: z.string().max(200),
      type: z.string().max(100),
      required: z.boolean(),
      options: z.array(z.string().max(1000)).max(500).optional(),
      value: z.string().max(5000),
      source: z.enum(['cv', 'answers', 'ai', 'handoff', 'file']),
      note: z.string().max(500).optional(),
    }),
  )
  .max(200);

const Patch = z.strictObject({
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(20_000).optional(),
  cv: Plan.optional(),
  letter: z.string().max(20_000).optional(),
  answers: Answers.optional(),
});

async function load(idParam: string | undefined) {
  const id = /^\d{1,9}$/.test(idParam ?? '') ? Number(idParam) : NaN;
  const posting = Number.isNaN(id) ? null : await getPosting(getSql(), id);
  if (!posting) throw new HttpError(404, 'Not found');
  return posting;
}

/** The posting, its history, and the base CV's sections (what the plan editor picks from). */
async function view(id: string | undefined, store: ContentStore) {
  const posting = await load(id);
  const [events, base] = await Promise.all([listEvents(getSql(), posting.id), baseCv(store)]);
  return json({ posting, events, cvSections: base.cv?.sections ?? {} });
}

export const GET = careerRoute(async (ctx, store) => view(ctx.params.id, store));

/** A plan's sections and requirements without the computed coverage, to tell an edit from a no-op. */
const bare = (cv: Pick<TailorPlan, 'sections' | 'requirements'>) =>
  JSON.stringify([cv.sections, cv.requirements.map(({ term, kind, evidence }) => [term, kind, evidence])]);

/**
 * `{ status?, notes?, cv?, letter?, answers? }`: each change that differs from the stored value is saved and logged as an event.
 * The owner may reword `cv` freely, but it still goes through assembleCv: only the CV's own sections and entries, and
 * no more highlights than an entry has, and no skills item it lacks. A `cv` without `requirements` keeps the stored
 * ones; their coverage is recomputed for the new sections. A status change away from `ready` withdraws an approval the
 * submit queue hasn't claimed yet.
 */
export const PATCH = careerRoute(async (ctx, store) => {
  const posting = await load(ctx.params.id);
  const body = Patch.parse(await readBody(ctx));
  const sql = getSql();
  const stored = posting.cv as Partial<TailorPlan> | null;
  const cv = body.cv && {
    sections: body.cv.sections,
    requirements: body.cv.requirements ?? stored?.requirements ?? [],
  };
  if (
    cv &&
    (!stored?.sections || bare(cv) !== bare({ sections: stored.sections, requirements: stored.requirements ?? [] }))
  ) {
    const base = await baseCv(store);
    if (!base.cv?.sections) throw new HttpError(400, 'There is no CV to tailor: add one on the CV screen');
    let next: Pick<TailorPlan, 'sections' | 'requirements'>;
    try {
      next = withCoverage(base, cv);
    } catch (e) {
      if (e instanceof FabricationError) throw new HttpError(400, e.message);
      throw e;
    }
    await updatePosting(sql, posting.id, { cv: next });
    await addEvent(sql, posting.id, 'cv edited');
  }
  if (body.letter !== undefined && body.letter !== posting.letter) {
    await updatePosting(sql, posting.id, { letter: body.letter });
    await addEvent(sql, posting.id, 'letter edited');
  }
  if (body.answers !== undefined && JSON.stringify(body.answers) !== JSON.stringify(posting.answers)) {
    await updatePosting(sql, posting.id, { answers: body.answers });
    await addEvent(sql, posting.id, 'answers edited');
  }
  if (body.status !== undefined && body.status !== posting.status) {
    // Moving on from `ready` takes back an approval the queue hasn't claimed; one that may have gone out stays as is.
    if (body.status !== 'ready' && posting.application?.state === 'approved') {
      await withdrawApproval(sql, posting.id, posting.application);
    }
    await updatePosting(sql, posting.id, { status: body.status });
    await addEvent(sql, posting.id, 'status', `${posting.status} → ${body.status}`);
  }
  if (body.notes !== undefined && body.notes !== posting.notes) {
    await updatePosting(sql, posting.id, { notes: body.notes });
    await addEvent(sql, posting.id, 'notes edited');
  }
  return view(ctx.params.id, store);
});
