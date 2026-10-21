// The nightly run's steps. Each takes and returns ids and plain JSON (the workflow log stores both) and reads
// keys, prefs and the CV itself.
import { generateText, readAiConfig } from '../admin/ai';
import { readConfig } from '../admin/content';
import { getStore } from '../admin/get-store';
import { postgresOnly } from '../admin/http';
import { getSecret } from '../admin/secrets';
import { resolveCvConfig } from '../cv';
import { getSql } from '../db';
import type { CvConfig } from '../types';
import { getPosting, readCareer, updatePosting, upsertPostings, writeCareer } from './db';
import { guardPosting } from './guard';
import { hardGate, postingKey } from './match';
import { cvText, prefsText } from './profile';
import { parseScore, scorePrompt, totalScore } from './score';
import { parseAnswers, parsePrefs } from './settings';
import { SOURCES, type SourceContext } from './sources';
import { SourceError } from './sources/http';
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
 * Searches one source, fetches the detail of new postings that came without a description (at most 30), then guards,
 * keys, gates and stores each. Never throws: a failure is the result's `error`. A posting the guard can't scan, or
 * whose detail fetch fails, is counted in `found` and skipped (a later night tries it again); the first failed fetch
 * is the result's `error`, next to what was added.
 */
export async function gatherSource(id: string): Promise<{ id: string; found: number; added: number; error?: string }> {
  'use step';
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
    const raws = await source.search(ctx);
    found = raws.length;
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
      if (source.detail && !p.description.trim() && !known.has(key) && details < MAX_DETAILS) {
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

/** Scores one posting against the CV and prefs; a no-op once scored. Throws on a bad reply, so the Workflow retries. */
export async function scorePosting(id: number): Promise<void> {
  'use step';
  const sql = getSql();
  const store = careerStore();
  const p = await getPosting(sql, id);
  if (!p || p.score !== null) return;
  const [cv, upload, career, ai] = await Promise.all([
    readConfig(store, 'cv'),
    readConfig(store, 'cv-upload'),
    readCareer(sql),
    readAiConfig(store),
  ]);
  const resolved = resolveCvConfig(
    upload.data as { enabled?: boolean; content?: string },
    () => cv.data as unknown as CvConfig,
  );
  if (!resolved?.cv) throw new Error('There is no CV to score against');
  const prompt = scorePrompt(p, cvText(resolved), prefsText(parsePrefs(career.prefs), parseAnswers(career.answers)));
  const detail = parseScore(await generateText(store, ai, prompt));
  const { score, gate } = totalScore(detail);
  await updatePosting(sql, id, { score, scoreDetail: detail, gate });
}
// Three attempts in all: a reply that isn't the JSON asked for rarely improves after that, and each one costs a call.
scorePosting.maxRetries = 2;

export async function markScoreFailed(id: number, error: string): Promise<void> {
  'use step';
  await updatePosting(getSql(), id, { scoreError: error.slice(0, 500) });
}

export async function finishRun(summary: RunSummary): Promise<void> {
  'use step';
  await writeCareer(getSql(), { lastRun: summary }, BOT.name);
}
