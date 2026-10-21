// The nightly run's steps. Each takes and returns ids and plain JSON (the workflow log stores both) and reads
// keys, prefs and the CV itself.
import { generateText, readAiConfig } from '../admin/ai';
import { readConfig } from '../admin/content';
import { getStore } from '../admin/get-store';
import { postgresOnly } from '../admin/http';
import type { PostgresStore } from '../admin/postgres-store';
import { getSecret, missingKey } from '../admin/secrets';
import { TEXT_PROVIDERS } from '../ai/providers';
import { resolveCvConfig } from '../cv';
import { configPath, PathError, THEME_NAME } from '../admin/paths';
import { CvRenderError, cvRenderRequest, renderCv } from '../cv-render';
import { BUILT_IN_THEMES, parseStyles, readThemeFiles } from '../cv-styles';
import { getSql } from '../db';
import type { CvConfig } from '../types';
import { addEvent, getPosting, readCareer, updatePosting, upsertPostings, writeCareer } from './db';
import { pdfPages, putCareerPdf } from './files';
import { answersPrompt, type FormAnswer, greenhouseQuestions, parseFormAnswers, splitQuestions } from './answers';
import { guardPosting } from './guard';
import { hardGate, postingKey, tidyPosting } from './match';
import { cvText, prefsText } from './profile';
import { parseScore, scorePrompt, totalScore, type ScoreDetail } from './score';
import { parseAnswers, parsePrefs } from './settings';
import { SOURCES, type SourceContext } from './sources';
import { SourceError } from './sources/http';
import { clearRobotsCache } from './sources/robots';
import {
  assembleCv,
  baseCv,
  draftPrompt,
  FabricationError,
  paperAbstracts,
  parseReview,
  parseTailorPlan,
  reviewPrompt,
  rewordedPairs,
  type DraftPart,
  type ReviewIssue,
  type TailorPlan,
  withCoverage,
} from './tailor';
import type { RunSummary } from './types';

/** The same bot author as the daily cron; these steps only read content. */
const BOT = { name: 'ScholarOS jobs', email: 'scholaros-jobs@users.noreply.github.com' };
const MAX_DETAILS = 30;

const careerStore = () => postgresOnly(getStore(BOT));

/** The message a run summary may hold: a SourceError's own (http.ts keeps queries out), else a generic one. */
function sourceMessage(id: string, e: unknown): string {
  if (e instanceof SourceError) return e.message;
  // eslint-disable-next-line no-console
  console.error(`[career] ${id}`, e);
  return 'unexpected error';
}

/** Sources on in prefs (`defaultOn` when prefs don't say); one missing a key it needs comes back `skipped`. */
export async function enabledSources(): Promise<{ sources: { id: string; skipped?: string }[]; maxScores: number }> {
  'use step';
  const sql = getSql();
  const prefs = parsePrefs((await readCareer(sql)).prefs);
  const sources: { id: string; skipped?: string }[] = [];
  for (const [id, source] of Object.entries(SOURCES)) {
    if (!(prefs.sources[id]?.on ?? source.defaultOn)) continue;
    let missing: string | undefined;
    for (const name of source.needs ?? []) if (!missing && !(await getSecret(sql, name))) missing = name;
    sources.push(missing ? { id, skipped: `no ${missing}` } : { id });
  }
  return { sources, maxScores: prefs.maxScoresPerRun };
}

/**
 * Searches one source, fetches the detail of new postings that came without a description (at most 30; new ones past
 * that wait, unstored, for a later night), then guards, keys, gates and stores each. Never throws: a failure is the
 * result's `error`. A posting the guard can't scan, or whose detail fetch fails, is counted in `found` and skipped (a
 * later night tries it again); the first failed fetch is the result's `error`, next to what was added.
 */
export async function gatherSource(id: string): Promise<{ id: string; found: number; added: number; error?: string }> {
  'use step';
  // A robots.txt answer (or failure) is good for this run only, not for the warm instance's life.
  clearRobotsCache();
  const source = SOURCES[id];
  let found = 0;
  let error: string | undefined;
  try {
    const sql = getSql();
    const store = careerStore();
    const [career, site] = await Promise.all([readCareer(sql), readConfig(store, 'site')]);
    const prefs = parsePrefs(career.prefs);
    const ctx: SourceContext = {
      prefs,
      secret: (name) => getSecret(sql, name),
      siteUrl: typeof site.data.siteUrl === 'string' ? site.data.siteUrl : '',
      ai: async (input) => generateText(store, await readAiConfig(store), input),
    };
    const searched = await source.search(ctx);
    found = searched.length;
    const raws = searched.flatMap((r) => tidyPosting(r) ?? []);
    const keyed = raws.map((raw) => ({ raw, key: postingKey(raw) }));
    const known = new Set(
      (
        await sql<{ key: string }>`select key from career_postings
          where key in (select jsonb_array_elements_text(${JSON.stringify(keyed.map((k) => k.key))}::text::jsonb))`
      ).map((r) => r.key),
    );
    let details = 0;
    const rows = [];
    for (const { raw, key } of keyed) {
      let p = raw;
      if (source.detail && !p.description.trim() && !known.has(key)) {
        if (details === MAX_DETAILS) continue; // the rest wait for a later night
        details++;
        try {
          p = { ...p, ...(await source.detail(p, ctx)) };
        } catch (e) {
          error ??= sourceMessage(id, e);
          continue;
        }
      }
      let guarded;
      try {
        guarded = guardPosting(p.description, p.format);
      } catch {
        continue; // HTML nested too deeply to scan
      }
      rows.push({ ...p, key, ...guarded, gate: hardGate({ ...p, description: guarded.text }, prefs) });
    }
    const added = await upsertPostings(sql, rows);
    return error ? { id, found, added, error } : { id, found, added };
  } catch (e) {
    return { id, found, added: 0, error: sourceMessage(id, e) };
  }
}

// It never throws, so a retry would only follow a function timeout, and would repeat the careers pages' AI calls; the
// workflow reports the failure.
gatherSource.maxRetries = 0;

/** Unscored, ungated postings that haven't failed scoring, newest first: up to `limit` ids, and how many wait past it. */
export async function pendingScores(limit: number): Promise<{ ids: number[]; deferred: number }> {
  'use step';
  const rows = await getSql()<{ id: number; total: number }>`
    select id, count(*) over () as total from career_postings
    where gate is null and score is null and score_error is null
    order by found_at desc, id desc
    limit ${limit}`;
  const ids = rows.map((r) => Number(r.id));
  return { ids, deferred: rows.length ? Number(rows[0].total) - ids.length : 0 };
}

/** The CV read through the store as cv-render does (an enabled upload wins); `cv` is missing when there is none. */
export async function readCv(store: PostgresStore): Promise<CvConfig> {
  const [cv, upload] = await Promise.all([readConfig(store, 'cv'), readConfig(store, 'cv-upload')]);
  return resolveCvConfig(upload.data as { enabled?: boolean; content?: string }, () => cv.data as unknown as CvConfig);
}

/** The CV as prompt text; '' when there is none. */
export async function cvTextOf(store: PostgresStore): Promise<string> {
  const resolved = await readCv(store);
  return resolved?.cv ? cvText(resolved).trim() : '';
}

/** Why the AI can't work on postings (no key for the configured text provider, or no CV), or null when ready. */
export async function scoreReady(): Promise<string | null> {
  'use step';
  const store = careerStore();
  const ai = await readAiConfig(store);
  for (const name of TEXT_PROVIDERS[ai.text.provider].keys)
    if (!(await getSecret(getSql(), name))) return missingKey(name).message;
  return (await cvTextOf(store)) ? null : 'There is no CV yet: add one on the CV screen';
}

const REPLIES = 3;

/**
 * Scores one posting against the CV and prefs; a no-op once scored. A model that answers three times without the JSON
 * asked for gives the reason back (the run records it). Provider and network errors throw, and the posting stays
 * pending for the next night. The reason travels as a return value because a thrown error reaches the workflow as
 * message, stack and cause only, not as its class.
 */
export async function scorePosting(id: number): Promise<string | null> {
  'use step';
  const sql = getSql();
  const store = careerStore();
  const p = await getPosting(sql, id);
  if (!p || p.score !== null) return null;
  const [cv, career, ai] = await Promise.all([cvTextOf(store), readCareer(sql), readAiConfig(store)]);
  const prompt = scorePrompt(p, cv, prefsText(parsePrefs(career.prefs), parseAnswers(career.answers)));
  for (let reply = 1; ; reply++) {
    const text = await generateText(store, ai, prompt);
    let detail: ScoreDetail;
    try {
      detail = parseScore(text);
    } catch (e) {
      if (reply === REPLIES) return (e as Error).message;
      continue;
    }
    const { score, gate } = totalScore(detail);
    await updatePosting(sql, id, { score, scoreDetail: detail, gate });
    return null;
  }
}
// No step retries: a provider or network error leaves the posting for tomorrow, so one posting costs at most 3 AI
// calls a night (the bad-reply loop above).
scorePosting.maxRetries = 0;

/** A posting scored in the meantime keeps its score. */
export async function markScoreFailed(id: number, error: string): Promise<void> {
  'use step';
  await getSql()`update career_postings set score_error = ${error.slice(0, 500)}, scored_at = now()
    where id = ${id} and score is null`;
}

export async function finishRun(summary: RunSummary): Promise<void> {
  'use step';
  await writeCareer(getSql(), { lastRun: summary }, BOT.name);
}

// ---- Drafting: a tailored CV and cover letter for one posting (careerDraft) ----

const NO_CV = 'There is no CV to tailor: add one on the CV screen';
const TRIES = 2;

export async function startDraft(id: number, part: DraftPart): Promise<void> {
  'use step';
  const sql = getSql();
  await updatePosting(sql, id, { draftState: 'running' });
  await addEvent(sql, id, 'draft started', part);
}

/**
 * Drafts the plan and letter and saves the part asked for (`letter` keeps the current CV, `cv` the current letter).
 * A reply that isn't the plan, or a plan that reaches past the CV, is asked again once with the reason; a second
 * failure's reason is returned (as a value: a thrown error reaches the workflow without its class). Provider and
 * network errors throw.
 */
export async function draftStep(
  id: number,
  part: DraftPart,
  instruction: string,
  issues: ReviewIssue[] | null,
): Promise<string | null> {
  'use step';
  const sql = getSql();
  const store = careerStore();
  const [p, base, abstracts, career, ai] = await Promise.all([
    getPosting(sql, id),
    baseCv(store),
    paperAbstracts(store),
    readCareer(sql),
    readAiConfig(store),
  ]);
  if (!p) return 'The posting no longer exists';
  if (!base.cv?.sections) return NO_CV;
  const prompt = draftPrompt(base, p, parseAnswers(career.answers), instruction, issues ?? undefined, abstracts);
  let plan: TailorPlan | null = null;
  let rejected = '';
  for (let attempt = 1; !plan; attempt++) {
    const again = `\n\nYour last reply was rejected: ${rejected}. Reply again with the corrected JSON.`;
    const text = await generateText(store, ai, rejected ? { ...prompt, prompt: prompt.prompt + again } : prompt);
    try {
      plan = parseTailorPlan(text);
      if (part !== 'letter') assembleCv(base, plan);
    } catch (e) {
      plan = null;
      rejected = (e as Error).message;
      if (attempt === TRIES) return rejected;
    }
  }
  await updatePosting(sql, id, {
    ...(part === 'letter'
      ? {}
      : { cv: withCoverage(base, { sections: plan.sections, requirements: plan.requirements }) }),
    ...(part === 'cv' ? {} : { letter: plan.letter }),
  });
  return null;
}

/**
 * Proposes answers to the posting's Greenhouse form and saves them: known fields from the CV and the Application
 * answers, EEO by the owner's setting, the rest from the AI. Why not is returned as a value (a failed fetch, a reply
 * that isn't the JSON asked for); provider errors throw. Nothing is submitted.
 */
export async function answersStep(id: number, instruction: string): Promise<string | null> {
  'use step';
  const sql = getSql();
  const store = careerStore();
  const p = await getPosting(sql, id);
  if (!p) return 'The posting no longer exists';
  if (p.ats?.kind !== 'greenhouse') return 'Only Greenhouse postings have a form to answer';
  const [base, career, ai] = await Promise.all([baseCv(store), readCareer(sql), readAiConfig(store)]);
  if (!base.cv?.sections) return NO_CV;
  const a = parseAnswers(career.answers);
  let qs: Awaited<ReturnType<typeof greenhouseQuestions>>;
  try {
    qs = await greenhouseQuestions(p.ats.board, p.ats.id);
  } catch (e) {
    if (e instanceof SourceError) return `Could not read the application form: ${e.message}`;
    throw e;
  }
  const known = splitQuestions(qs, base, a);
  let proposed: FormAnswer[] = [];
  if (known.rest.length) {
    const prompt = answersPrompt(known.rest, base, a, p);
    const text = await generateText(
      store,
      ai,
      instruction.trim()
        ? { ...prompt, prompt: `${prompt.prompt}\n\nThe candidate asks: ${instruction.trim().slice(0, 500)}` }
        : prompt,
    );
    try {
      proposed = parseFormAnswers(text, known.rest);
    } catch (e) {
      return (e as Error).message;
    }
  }
  // In the form's own order.
  const byField = new Map([...known.answers, ...proposed].map((x) => [x.field, x]));
  await updatePosting(sql, id, { answers: qs.flatMap((q) => byField.get(q.field) ?? []) });
  return null;
}
answersStep.maxRetries = 0;

/** A form-answers failure during a full draft doesn't fail the CV draft: it is only recorded. */
export async function noteAnswersFailed(id: number, message: string): Promise<void> {
  'use step';
  await addEvent(getSql(), id, 'answers failed', message.slice(0, 500));
}

/**
 * The reviewer's verdict on what this draft wrote: the saved plan's reworded lines (unless `part` is `letter`) and the
 * saved letter (unless `part` is `cv`). A one-part review tags every issue with that part. Nothing to review is ok
 * without an AI call.
 */
export async function reviewStep(id: number, part: DraftPart): Promise<{ ok: boolean; issues: ReviewIssue[] }> {
  'use step';
  const store = careerStore();
  const [p, base, ai] = await Promise.all([getPosting(getSql(), id), baseCv(store), readAiConfig(store)]);
  const plan = p?.cv as TailorPlan | null;
  const pairs = part !== 'letter' && plan?.sections && base.cv?.sections ? rewordedPairs(base, plan) : [];
  const letter = part === 'cv' ? '' : (p?.letter ?? '');
  if (!pairs.length && !letter) return { ok: true, issues: [] };
  const review = parseReview(await generateText(store, ai, reviewPrompt(base, pairs, letter)));
  return part === 'cv' || part === 'letter'
    ? { ...review, issues: review.issues.map((i) => ({ ...i, part })) }
    : review;
}
// The AI-call ceiling per draft is 7: two drafts of at most two replies each, two reviews, and (a Greenhouse `all`
// draft) one answers call. No step retries them.
draftStep.maxRetries = 0;
reviewStep.maxRetries = 0;

/**
 * Renders the saved plan in `prefs.cvStyle` (or the public style) and stores the PDF; why not, as a value. The papers
 * the plan selected are in its sections already (baseCv), so the collection itself is never sent.
 */
export async function renderStep(id: number): Promise<string | null> {
  'use step';
  const sql = getSql();
  const store = careerStore();
  const [p, base, career, styles] = await Promise.all([
    getPosting(sql, id),
    baseCv(store),
    readCareer(sql),
    store.read(configPath('cv-styles')),
  ]);
  const plan = p?.cv as TailorPlan | null;
  if (!plan?.sections) return 'There is no tailored CV to render yet';
  if (!base.cv?.sections) return NO_CV;
  let pdf: Uint8Array;
  try {
    const cv = assembleCv(base, plan);
    const wanted = parsePrefs(career.prefs).cvStyle;
    const style = parseStyles(styles?.content, base).styles.find((s) => s.id === wanted);
    const req = await cvRenderRequest(store, style);
    // The theme files are the style's own: with `upload: null` an enabled upload's design theme must not pick them.
    const { theme } = req.style;
    const custom = !(BUILT_IN_THEMES as readonly string[]).includes(theme);
    if (custom && !THEME_NAME.test(theme)) throw new PathError(`Invalid theme name: ${theme}`);
    pdf = await renderCv({
      ...req,
      cv,
      upload: null,
      publications: [],
      themeFiles: custom ? await readThemeFiles(store, theme) : {},
    });
  } catch (e) {
    if (e instanceof FabricationError) return `The CV changed since this plan: ${e.message}`;
    if (e instanceof CvRenderError) return e.message;
    throw e;
  }
  await putCareerPdf(id, pdf);
  // The model can't see the rendered length, so the page count is checked here.
  const pages = pdfPages(pdf);
  if (pages > 2) await addEvent(sql, id, 'long cv', `The tailored CV runs to ${pages} pages; the aim is at most 2.`);
  return null;
}
renderStep.maxRetries = 1;

/**
 * `needs-review` with the issues when any part still has some, else `done`; `found` moves to `drafted`. A `cv` or
 * `letter` review replaces only that part's issues; with no review (a re-render of the owner's edits, or form answers)
 * the earlier issues stand: only a review of their part clears them. Form answers alone on a posting with no CV or
 * letter leave the draft `none`.
 */
export async function finishDraft(
  id: number,
  review: { ok: boolean; issues: ReviewIssue[] } | null,
  part: DraftPart = 'all',
): Promise<void> {
  'use step';
  const sql = getSql();
  const p = await getPosting(sql, id);
  const before = (p?.draftIssues as ReviewIssue[] | null) ?? [];
  const issues = !review
    ? before
    : part === 'cv' || part === 'letter'
      ? [...before.filter((i) => i.part !== part), ...review.issues]
      : review.issues;
  const flagged = issues.length > 0 || (review !== null && !review.ok);
  const drafted = p?.cv != null || p?.letter != null;
  await updatePosting(sql, id, {
    draftState: flagged ? 'needs-review' : drafted ? 'done' : 'none',
    draftIssues: flagged ? issues : null,
  });
  const moved =
    await sql`update career_postings set status = 'drafted' where id = ${id} and status = 'found' returning id`;
  if (moved.length) await addEvent(sql, id, 'status', 'found → drafted');
  await addEvent(sql, id, 'draft finished', flagged ? `needs review (${issues.length} issues)` : 'done');
}

export async function failDraft(id: number, message: string): Promise<void> {
  'use step';
  const sql = getSql();
  await updatePosting(sql, id, { draftState: 'failed' });
  await addEvent(sql, id, 'draft failed', message.slice(0, 500));
}
