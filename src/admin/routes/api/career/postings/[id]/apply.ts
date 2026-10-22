import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../../lib/admin/http';
import { getPosting } from '../../../../../../lib/career/db';
import { careerRoute } from '../../../../../../lib/career/route';
import { getSql } from '../../../../../../lib/db';
import {
  answerUnconfirmed,
  approve,
  handOff,
  skipApplication,
  startPrefill,
} from '../../../../../../workflows/career-apply';

export const prerender = false;

const Body = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prefill') }),
  z.strictObject({
    action: z.literal('approve'),
    /** The `application.at` of the pre-fill the owner saw. */
    at: z.string().max(100),
    // Only id and value are read; the field shapes stay the server's.
    fields: z.array(z.object({ id: z.string().max(500), value: z.string().max(20_000) })).max(300),
  }),
  z.strictObject({ action: z.literal('skip') }),
  z.strictObject({ action: z.literal('handoff') }),
  z.strictObject({ action: z.literal('confirm') }),
  z.strictObject({ action: z.literal('not-sent') }),
]);

const PREFILL: Record<string, [number, string]> = {
  'no-draft': [400, 'Tailor a CV for this posting first'],
  running: [409, 'This application is already being filled in'],
  busy: [409, 'Another application is being filled in or sent: try again in a few minutes'],
  locked: [409, 'This application is approved or was sent: it can’t be filled in again'],
};

/**
 * `{ action: 'prefill' }` → `{ runId }`. `approve` with `at` (the pre-fill's `application.at`) and `fields` (`{ id,
 * value }` for exactly that pre-fill's ids; another pre-fill or other ids → 409) → `{ application, queued }`, where
 * `queued` false means the approval stands but the queue didn't start (the nightly run starts it). `skip` (status
 * skipped, withdrawing an approval not yet sent), `handoff` (finish it yourself), and for an `unconfirmed` one
 * `confirm` (it went out: submitted) or `not-sent` (failed, may be pre-filled again) → `{ application }`.
 */
export const POST = careerRoute(async (ctx, _store, user) => {
  const id = /^\d{1,9}$/.test(ctx.params.id ?? '') ? Number(ctx.params.id) : NaN;
  if (Number.isNaN(id)) throw new HttpError(404, 'Not found');
  const body = Body.parse(await readBody(ctx));
  const sql = getSql();
  if (body.action === 'prefill') {
    const started = await startPrefill(sql, id);
    if (!started) throw new HttpError(404, 'Not found');
    if (typeof started === 'string') throw new HttpError(...PREFILL[started]);
    return json(started);
  }
  if (body.action === 'approve') {
    const out = await approve(sql, id, body.fields, body.at, user.login);
    if (out === 'not-ready') throw new HttpError(409, 'This application isn’t waiting for approval');
    if (out === 'changed-values') {
      throw new HttpError(409, 'The fields don’t match the pre-filled form: reload and approve again');
    }
    return json({ application: (await getPosting(sql, id))?.application ?? null, queued: out.queued });
  }
  if (body.action === 'confirm' || body.action === 'not-sent') {
    const out = await answerUnconfirmed(sql, id, body.action === 'confirm');
    if (!out) throw new HttpError(404, 'Not found');
    if (out === 'conflict') throw new HttpError(409, 'This application isn’t waiting for you to check it');
  } else {
    const out = await (body.action === 'skip' ? skipApplication : handOff)(sql, id);
    if (!out) throw new HttpError(404, 'Not found');
    if (out === 'conflict')
      throw new HttpError(409, 'This application is being sent or was sent: it can’t be withdrawn');
  }
  return json({ application: (await getPosting(sql, id))?.application ?? null });
});
