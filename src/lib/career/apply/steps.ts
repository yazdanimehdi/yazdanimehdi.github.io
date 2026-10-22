// The apply steps: pre-fill a posting's form (never submitting it) and submit exactly what the owner approved.
import { basename } from 'node:path';
import { getStore } from '../../admin/get-store';
import { postgresOnly } from '../../admin/http';
import { getSql, type Sql } from '../../db';
import {
  addEvent,
  applyBusy,
  approvedPostings,
  claimWithLock,
  getPosting,
  moveApplication,
  readCareer,
  releaseApplyLock,
} from '../db';
import { putCareerFile } from '../files';
import { parseAnswers, parsePrefs } from '../settings';
import { baseCv } from '../tailor';
import { workerText } from '../worker';
import type { PostingStatus } from '../types';
import { runInApplySandbox, RunnerLostError, stopApplySandbox } from './sandbox';
import type { Application, ApplyField, ApplyState, RunnerResult } from './types';
import { knownValues, needsHandoff, parseValues, valuesPrompt } from './values';

const BOT = { name: 'ScholarOS jobs', email: 'scholaros-jobs@users.noreply.github.com' };
const careerStore = () => postgresOnly(getStore(BOT));

const BLOCKERS: Record<NonNullable<RunnerResult['blocker']>, string> = {
  captcha: 'The form has a captcha: finish this one yourself',
  login: 'The form needs you to sign in: finish this one yourself',
  account: 'The form needs you to create an account: finish this one yourself',
  'no-form': 'No application form was found on the page: finish this one yourself',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The cover letter as a plain serif page for the runner to print: the owner's name, then the letter's paragraphs. */
export function letterHtml(letter: string, name: string): string {
  const paragraphs = letter
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body { font: 11pt/1.5 Georgia, 'Times New Roman', serif; color: #111; margin: 2.5cm; }
h1 { font-size: 16pt; font-weight: normal; margin: 0 0 1.5em; }
p { margin: 0 0 1em; }
</style></head><body>${name.trim() ? `<h1>${esc(name.trim())}</h1>` : ''}
${paragraphs}</body></html>`;
}

/**
 * Moves the application from `from` (the very claim, by its `at`) to `app` (and the posting to `status`) and records
 * it, unless someone moved it first; then the stored application is returned and nothing is recorded. A pre-fill or
 * submit run ends here either way, so it lets go of the apply lock (and stops the VM) if it still holds it.
 */
async function settle(
  sql: Sql,
  id: number,
  from: { state: ApplyState; at: string },
  app: Application,
  status?: PostingStatus,
): Promise<Application | null> {
  const old = await moveApplication(sql, id, from, app, status);
  if (from.state === 'prefilling' || from.state === 'submitting') {
    await releaseApplyLock(sql, id, from.at, stopApplySandbox);
  }
  if (!old) return (await getPosting(sql, id))?.application ?? null;
  await addEvent(sql, id, 'apply', (app.reason ? `${app.state}: ${app.reason}` : app.state).slice(0, 500));
  if (status && old !== status) await addEvent(sql, id, 'status', `${old} → ${status}`);
  return app;
}

/** Stores the screenshots and letter PDF a run brought back; the result's VM paths become Blob URLs. */
async function keep(id: number, run: { shots: string[]; letterPdf?: string; files: Record<string, Buffer> }) {
  const put = async (path: string) =>
    run.files[path]
      ? putCareerFile(id, basename(path), run.files[path], path.endsWith('.pdf') ? 'application/pdf' : 'image/png')
      : null;
  const shots = (await Promise.all(run.shots.map(put))).filter((u): u is string => !!u);
  const letterPdf = run.letterPdf ? ((await put(run.letterPdf)) ?? undefined) : undefined;
  return { shots, letterPdf };
}

const pending = (f: ApplyField) => f.source === 'ai' && !f.value;

/**
 * Reads the form, works out its values (CV and Application answers first, the AI for the rest), fills it without
 * submitting, and stores the screenshot and letter: state `ready` (status `ready`), `handoff` (a blocker or a value it
 * isn't sure of; status unchanged) or `failed`. A posting that is no longer `prefilling` is left alone, so a retry or
 * a late run can't overwrite what happened since.
 */
export async function prefillStep(id: number): Promise<Application | null> {
  'use step';
  const sql = getSql();
  const p = await getPosting(sql, id);
  const start = p?.application ?? null;
  if (!p || start?.state !== 'prefilling') return start;
  const end = (patch: Partial<Application> & Pick<Application, 'state'>) =>
    settle(
      sql,
      id,
      { state: 'prefilling', at: start.at },
      { url: start.url, fields: [], shots: [], ...patch, at: new Date().toISOString() },
      patch.state === 'ready' ? 'ready' : undefined,
    );
  if (!p.cvPdfUrl) return end({ state: 'failed', reason: 'There is no tailored CV: draft one first' });

  const read = await runInApplySandbox({ mode: 'read', url: start.url });
  const url = read.url || start.url;
  if (read.blocker) return end({ state: 'handoff', url, fields: read.fields, reason: BLOCKERS[read.blocker] });
  if (!read.ok) return end({ state: 'failed', url, reason: read.error ?? 'The form could not be read' });

  const store = careerStore();
  const [cv, career] = await Promise.all([baseCv(store), readCareer(sql)]);
  const answers = parseAnswers(career.answers);
  let fields = knownValues(read.fields, cv, answers, !!p.letter?.trim());
  if (fields.some(pending)) {
    const prompt = valuesPrompt(fields, p, cv, answers, p.letter ?? '');
    fields = parseValues(await workerText(store, parsePrefs(career.prefs), prompt), fields);
  }
  const unsure = needsHandoff(fields);
  if (unsure) return end({ state: 'handoff', url, fields, reason: unsure });

  const fill = await runInApplySandbox({
    mode: 'fill',
    url,
    values: fields.map((f) => ({ id: f.id, value: f.value })),
    cvPdfUrl: p.cvPdfUrl,
    ...(p.letter?.trim() ? { letterHtml: letterHtml(p.letter, cv.cv?.name ?? '') } : {}),
  });
  const files = await keep(id, fill);
  if (fill.blocker) return end({ state: 'handoff', url, fields, ...files, reason: BLOCKERS[fill.blocker] });
  if (!fill.ok)
    return end({ state: 'failed', url, fields, ...files, reason: fill.error ?? 'The form could not be filled' });
  // A question that appears only once others are answered was never given a value, and submit would see the form
  // differ from the one approved: the owner finishes it.
  const known = new Set(fields.map((f) => f.id));
  if (fill.fields.some((f) => !known.has(f.id))) {
    return end({
      state: 'handoff',
      url,
      fields,
      ...files,
      reason: 'The form asks more questions once it is filled in: finish this one yourself',
    });
  }
  return end({ state: 'ready', url, fields, ...files, cvPdf: p.cvPdfUrl });
}
// Reading and filling never submit, so one retry is safe.
prefillStep.maxRetries = 1;

export async function failPrefill(id: number, reason: string): Promise<void> {
  'use step';
  const sql = getSql();
  const app = (await getPosting(sql, id))?.application;
  if (app?.state !== 'prefilling') return;
  await settle(
    sql,
    id,
    { state: 'prefilling', at: app.at },
    { ...app, state: 'failed', at: new Date().toISOString(), reason },
  );
}

/**
 * Submits the approved values. The application moves approved → submitting in one conditional UPDATE, taken together
 * with the apply lock, before the sandbox is touched: a retry, a second queue or a double click finds it no longer
 * approved and does nothing, and while another run holds the sandbox it stays approved for the queue to retry. Then
 * `submitted` (status too) when the page confirmed, `unconfirmed` when it may have gone out (never sent again),
 * `changed` when the live form differs from the approved one, `handoff` on a blocker, `failed` when nothing was sent.
 */
export async function submitStep(id: number): Promise<Application | null> {
  'use step';
  const sql = getSql();
  const at = new Date().toISOString();
  const claimed = await claimWithLock(sql, { postingId: id, kind: 'submit', at }, async (tx) => {
    const [row] = await tx<{ application: Application }>`
      update career_postings
      set application = application || jsonb_build_object('state', 'submitting', 'at', ${at}::text)
      where id = ${id} and application->>'state' = 'approved'
      returning application`;
    return row;
  });
  if (!claimed || claimed === 'busy') return (await getPosting(sql, id))?.application ?? null;
  const app = claimed.application;
  await addEvent(sql, id, 'apply', 'submitting');
  const end = (patch: Partial<Application> & Pick<Application, 'state'>, status?: PostingStatus) =>
    settle(sql, id, { state: 'submitting', at }, { ...app, ...patch, at: new Date().toISOString() }, status);
  if (!app.approved) return end({ state: 'failed', reason: 'There were no approved values to submit' });

  let result: Awaited<ReturnType<typeof runInApplySandbox>>;
  try {
    result = await runInApplySandbox({
      mode: 'submit',
      url: app.url,
      values: app.approved.fields.map((f) => ({ id: f.id, value: f.value })),
      expect: app.approved.fields,
      cvPdfUrl: app.cvPdf,
      letterPdfUrl: app.letterPdf,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (e instanceof RunnerLostError) {
      return end({ state: 'unconfirmed', reason: `${message}. It may have been sent: check before applying again` });
    }
    return end({ state: 'failed', reason: `Nothing was sent: ${message}` });
  }
  if (result.ok) {
    const [confirmation] = (await keep(id, result).catch(() => ({ shots: [] as string[] }))).shots;
    return result.confirmed
      ? end({ state: 'submitted', reason: undefined, ...(confirmation ? { confirmation } : {}) }, 'submitted')
      : end({
          state: 'unconfirmed',
          reason: `Submitted, but the page didn't confirm it${result.error ? ` (${result.error})` : ''}: check before applying again`,
          ...(confirmation ? { confirmation } : {}),
        });
  }
  if (result.changed?.length) {
    return end({
      state: 'changed',
      reason: `The form changed since you approved it (${result.changed.join(', ')}): pre-fill it again`,
    });
  }
  if (result.blocker) return end({ state: 'handoff', reason: BLOCKERS[result.blocker] });
  return end({ state: 'failed', reason: `Nothing was sent: ${result.error ?? 'the form could not be submitted'}` });
}
// Never retried: a retry could post the application twice.
submitStep.maxRetries = 0;

/**
 * After submitStep itself failed (a function timeout, a database error): one still `submitting` may have gone out, so
 * it is `unconfirmed`; one still `approved` was never claimed, so it is `failed` (and the queue moves past it).
 */
export async function submitLost(id: number, reason: string): Promise<void> {
  'use step';
  const sql = getSql();
  const app = (await getPosting(sql, id))?.application;
  if (app?.state === 'submitting') {
    await settle(
      sql,
      id,
      { state: 'submitting', at: app.at },
      {
        ...app,
        state: 'unconfirmed',
        at: new Date().toISOString(),
        reason: `The submission stopped half-way (${reason}). It may have been sent: check before applying again`,
      },
    );
  } else if (app?.state === 'approved') {
    await settle(
      sql,
      id,
      { state: 'approved', at: app.at },
      { ...app, state: 'failed', at: new Date().toISOString(), reason },
    );
  }
}

/**
 * The next approved posting to submit; `busy` while another run holds the sandbox; null once none is left, after
 * clearing the queue's run id (only while none is approved, so an approval in between keeps the queue going).
 */
export async function nextSubmit(): Promise<number | 'busy' | null> {
  'use step';
  const sql = getSql();
  const [next] = await approvedPostings(sql);
  if (next !== undefined) return (await applyBusy(sql, next)) ? 'busy' : next;
  const released = await sql`update career_settings set apply_queue_run_id = null
    where id = 1 and not exists (select 1 from career_postings where application->>'state' = 'approved')
    returning id`;
  return released.length ? null : ((await approvedPostings(sql))[0] ?? null);
}
