import { sleep } from 'workflow';
import { getRun, start } from 'workflow/api';
import type { Sql } from '../lib/db';
import { failPrefill, nextSubmit, prefillStep, submitLost, submitStep } from '../lib/career/apply/steps';
import { MAY_BE_SENT, type Application, type ApplyField } from '../lib/career/apply/types';
import {
  addEvent,
  applyBusy,
  getPosting,
  moveApplication,
  readCareer,
  readyPostings,
  updatePosting,
  writeCareer,
} from '../lib/career/db';
import { CLAIM, finished, reasonOf, type DraftRuns } from './career-draft';

/** Pre-fills one posting's application form; it never submits. */
export async function careerPrefill(id: number): Promise<void> {
  'use workflow';
  try {
    await prefillStep(id);
  } catch (e) {
    await failPrefill(id, reasonOf(e));
  }
}

/** Submits approved applications one at a time, waiting while a pre-fill holds the sandbox; returns how many went. */
export async function careerSubmitQueue(): Promise<number> {
  'use workflow';
  let submitted = 0;
  for (;;) {
    const next = await nextSubmit();
    if (next === null) return submitted;
    if (next === 'busy') {
      await sleep('1m');
      continue;
    }
    try {
      if ((await submitStep(next))?.state === 'submitted') submitted++;
    } catch (e) {
      await submitLost(next, reasonOf(e));
    }
  }
}

/** A pre-fill that still says prefilling after this is stuck (one takes a few minutes, a step at most 5). */
const PREFILL_STALE_MS = 15 * 60 * 1000;

/** The slice of the Workflow API the apply starters use; tests pass their own. */
export interface ApplyRuns {
  get: DraftRuns['get'];
  prefill(id: number): Promise<{ runId: string }>;
  queue(): Promise<{ runId: string }>;
}
const workflowRuns: ApplyRuns = {
  get: getRun,
  prefill: (id) => start(careerPrefill, [id]),
  queue: () => start(careerSubmitQueue),
};
let testRuns: ApplyRuns | null = null;

/** Tests swap the Workflow API; production code never calls this. */
export function setApplyRunsForTests(runs: ApplyRuns | null): void {
  testRuns = runs;
}

/**
 * Starts a pre-fill: `{ runId }`; `no-draft` without a tailored CV PDF; `locked` once the application is approved or
 * may have been sent; `running` while this posting's pre-fill runs; `busy` while another posting's apply run holds the
 * sandbox; null when there is no such posting.
 */
export async function startPrefill(
  sql: Sql,
  id: number,
  runs: ApplyRuns = testRuns ?? workflowRuns,
  now = Date.now(),
): Promise<{ runId: string } | 'running' | 'no-draft' | 'busy' | 'locked' | null> {
  const p = await getPosting(sql, id);
  if (!p) return null;
  if (!p.cvPdfUrl) return 'no-draft';
  const state = p.application?.state ?? null;
  if (state === 'approved' || (state && MAY_BE_SENT.includes(state))) return 'locked';
  if (state === 'prefilling' && !(await finished(p.applyRunId, runs, now, PREFILL_STALE_MS))) return 'running';
  if (await applyBusy(sql, id)) return 'busy';
  const app: Application = {
    state: 'prefilling',
    at: new Date(now).toISOString(),
    url: p.applyUrl ?? p.url,
    fields: [],
    shots: [],
  };
  // One conditional update, so two clicks can't both start: the second no longer finds the row it read.
  const [claimed] = await sql`update career_postings
    set application = ${JSON.stringify(app)}::text::jsonb, apply_run_id = ${CLAIM + now}
    where id = ${id} and application->>'state' is not distinct from ${state}
      and apply_run_id is not distinct from ${p.applyRunId}
    returning id`;
  if (!claimed) return 'running';
  let runId: string;
  try {
    ({ runId } = await runs.prefill(id));
  } catch (e) {
    await updatePosting(sql, id, {
      application: { ...app, state: 'failed', reason: 'Could not start' },
      applyRunId: null,
    });
    throw e;
  }
  await updatePosting(sql, id, { applyRunId: runId });
  await addEvent(sql, id, 'apply', 'prefilling');
  return { runId };
}

/** Starts the submit queue unless one runs (a queue still running after an hour is cancelled and replaced). */
export async function ensureSubmitQueue(sql: Sql, runs: ApplyRuns = testRuns ?? workflowRuns, now = Date.now()) {
  const { applyQueueRunId: prev } = await readCareer(sql);
  if (prev && !(await finished(prev, runs, now))) return;
  await sql`insert into career_settings (id) values (1) on conflict (id) do nothing`;
  const [claimed] = await sql`update career_settings set apply_queue_run_id = ${CLAIM + now}
    where id = 1 and apply_queue_run_id is not distinct from ${prev} returning id`;
  if (!claimed) return;
  let runId: string;
  try {
    ({ runId } = await runs.queue());
  } catch (e) {
    await writeCareer(sql, { applyQueueRunId: null }, 'ScholarOS jobs');
    throw e;
  }
  // ponytail: an approval landing in the instant the queue releases itself can wait for the next approval (or the
  // nightly run) to start a queue; a lock on career_settings would close it.
  await writeCareer(sql, { applyQueueRunId: runId }, 'ScholarOS jobs');
}

/**
 * Approves a `ready` application with the owner's values: the ids must be exactly the form's (each once); the labels,
 * kinds and options stay the server's, and a value the owner changed becomes source `owner`. Then the queue submits.
 */
export async function approve(
  sql: Sql,
  id: number,
  fields: Pick<ApplyField, 'id' | 'value'>[],
  by: string,
  runs: ApplyRuns = testRuns ?? workflowRuns,
): Promise<'ok' | 'not-ready' | 'changed-values'> {
  const app = (await getPosting(sql, id))?.application;
  if (app?.state !== 'ready') return 'not-ready';
  const given = new Map(fields.map((f) => [f.id, f.value]));
  if (given.size !== fields.length || given.size !== app.fields.length || app.fields.some((f) => !given.has(f.id))) {
    return 'changed-values';
  }
  const at = new Date().toISOString();
  const approved = app.fields.map((f) => {
    const value = given.get(f.id)!;
    return value === f.value ? f : { ...f, value, source: 'owner' as const };
  });
  // Matching `at` too: a re-fill that finished in between has other fields than the ones checked above.
  const next: Application = { ...app, state: 'approved', at, approved: { at, by, fields: approved } };
  if (!(await moveApplication(sql, id, { state: 'ready', at: app.at }, next))) return 'not-ready';
  await addEvent(sql, id, 'apply', `approved by ${by}`);
  await ensureSubmitQueue(sql, runs);
  return 'ok';
}

/** "Approve all ready": one approve() per `ready` posting with its pre-filled values, never a blanket permission. */
export async function approveAll(sql: Sql, by: string, runs: ApplyRuns = testRuns ?? workflowRuns) {
  const approved: number[] = [];
  const skipped: { id: number; reason: string }[] = [];
  for (const { id } of await readyPostings(sql)) {
    const fields = (await getPosting(sql, id))?.application?.fields ?? [];
    const out = await approve(sql, id, fields, by, runs);
    if (out === 'ok') approved.push(id);
    else skipped.push({ id, reason: out });
  }
  return { approved, skipped };
}

/**
 * The owner's way out of an application: `skip` (status skipped) or `handoff` (finish it yourself). Either withdraws
 * an approval the queue hasn't claimed yet; one that may have been sent can't be withdrawn (`conflict`).
 */
async function withdraw(sql: Sql, id: number, action: 'skip' | 'handoff'): Promise<'ok' | 'conflict' | null> {
  const p = await getPosting(sql, id);
  if (!p) return null;
  const app = p.application;
  if (app && MAY_BE_SENT.includes(app.state)) return 'conflict';
  if (app && (action === 'handoff' || app.state === 'approved')) {
    const { approved: _, ...rest } = app;
    const next: Application =
      action === 'handoff'
        ? { ...rest, state: 'handoff', at: new Date().toISOString(), reason: 'You chose to finish this one yourself' }
        : { ...rest, state: 'ready' };
    if (!(await moveApplication(sql, id, { state: app.state, at: app.at }, next))) return 'conflict';
    await addEvent(sql, id, 'apply', action === 'handoff' ? 'handoff: you chose to finish it' : 'approval withdrawn');
  } else if (!app && action === 'handoff') {
    const next: Application = {
      state: 'handoff',
      at: new Date().toISOString(),
      url: p.applyUrl ?? p.url,
      fields: [],
      shots: [],
      reason: 'You chose to finish this one yourself',
    };
    if (!(await moveApplication(sql, id, { state: null }, next))) return 'conflict';
    await addEvent(sql, id, 'apply', 'handoff: you chose to finish it');
  }
  if (action === 'skip' && p.status !== 'skipped') {
    await updatePosting(sql, id, { status: 'skipped' });
    await addEvent(sql, id, 'status', `${p.status} → skipped`);
  }
  return 'ok';
}

export const skipApplication = (sql: Sql, id: number) => withdraw(sql, id, 'skip');
export const handOff = (sql: Sql, id: number) => withdraw(sql, id, 'handoff');
