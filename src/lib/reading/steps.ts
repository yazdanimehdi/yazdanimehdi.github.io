// The nightly paper digest's steps. Each takes and returns ids and plain JSON (the workflow log stores both); pure
// helpers live in match.ts, rank.ts and prompts.ts, since a 'use step' module exports only steps.
import { generateText, readAiConfig } from '../admin/ai';
import { readConfig } from '../admin/content';
import { getStore } from '../admin/get-store';
import { postgresOnly } from '../admin/http';
import { paperLookupFor } from '../admin/papers';
import { getSecret, missingKey } from '../admin/secrets';
import { TEXT_PROVIDERS } from '../ai/providers';
import { getText, SourceError } from '../career/sources/http';
import { getSql } from '../db';
import {
  getPapers,
  mergeSignals,
  missingTexts,
  pruneCandidates,
  readReading,
  saveDigest,
  saveText,
  setScore,
  shownBefore,
  upsertPapers,
  writeReading,
} from './db';
import { sendReadingDigest } from './digest';
import { overlap, topByOverlap } from './match';
import { areaPrompt, parseArea, parseScores, scorePrompt } from './prompts';
import { profileText, readProfile } from './profile';
import { primary, reasonLine, resurfaces, signalLine, tractionScore } from './rank';
import { parseReadingPrefs } from './settings';
import { fetchNew, NEW_SOURCES } from './sources/new';
import { blueskyCount, fetchTraction, TRACTION_SOURCES } from './sources/traction';
import type { DigestSection, Paper, ReadingRun, Signals } from './types';

/** These steps only read content. */
const BOT = { name: 'ScholarOS reading', email: 'scholaros-reading@users.noreply.github.com' };
const MAX_PAPERS = 40;
const POOL = 60;

const readingStore = () => postgresOnly(getStore(BOT));
const readPrefs = async () => parseReadingPrefs((await readReading(getSql())).prefs);

/** The message a run summary may hold: a SourceError's own (http.ts keeps queries out), else a generic one. */
function sourceMessage(id: string, e: unknown): string {
  if (e instanceof SourceError) return e.message;
  // eslint-disable-next-line no-console
  console.error(`[reading] ${id}`, e);
  return 'unexpected error';
}

/** Tonight's settings: the day (UTC), whether paused, the sources on, and the limits. */
export async function readingPlan(): Promise<{
  day: string;
  paused: boolean;
  newSources: string[];
  tractionSources: string[];
  bluesky: boolean;
  talked: number;
  inField: number;
  maxAiCalls: number;
}> {
  'use step';
  const prefs = await readPrefs();
  return {
    day: new Date().toISOString().slice(0, 10),
    paused: prefs.paused,
    newSources: NEW_SOURCES.filter((id) => prefs.sources[id].on),
    tractionSources: TRACTION_SOURCES.filter((id) => prefs.sources[id].on),
    bluesky: prefs.sources.bluesky.on,
    talked: prefs.talked,
    inField: prefs.inField,
    maxAiCalls: prefs.maxAiCalls,
  };
}

export async function pruneStep(): Promise<number> {
  'use step';
  return pruneCandidates(getSql());
}

/**
 * The day's new papers from one source: the 60 with the most keyword overlap are stored, then those shown on an
 * earlier day or no longer 'new' are left out. Never throws: a failure is the result's `error`.
 */
export async function collectNew(
  id: string,
  day: string,
): Promise<{
  id: string;
  found: number;
  added: number;
  error?: string;
  candidates: { id: number; overlap: number }[];
}> {
  'use step';
  let found = 0;
  try {
    const sql = getSql();
    const prefs = await readPrefs();
    const lookup = await paperLookupFor(readingStore());
    const fetched = await fetchNew(id as (typeof NEW_SOURCES)[number], prefs, lookup.get, day);
    found = fetched.length;
    const cut = topByOverlap(fetched, (p) => overlap(p, prefs.keywords), POOL);
    const stored = await upsertPapers(sql, cut);
    const ids = stored.map((s) => s.id);
    const [shown, papers] = await Promise.all([shownBefore(sql, ids, day), getPapers(sql, ids)]);
    const fresh = new Set(papers.filter((p) => p.state === 'new' && !shown.has(p.id)).map((p) => p.id));
    return {
      id,
      found,
      added: stored.filter((s) => s.added).length,
      candidates: cut.flatMap((p, i) =>
        fresh.has(ids[i]) ? [{ id: ids[i], overlap: overlap(p, prefs.keywords) }] : [],
      ),
    };
  } catch (e) {
    return { id, found, added: 0, error: sourceMessage(id, e), candidates: [] };
  }
}

/** Why the AI can't run (no key for the configured text provider), or null when it can. */
export async function aiMissing(): Promise<string | null> {
  'use step';
  const ai = await readAiConfig(readingStore());
  for (const name of TEXT_PROVIDERS[ai.text.provider].keys)
    if (!(await getSecret(getSql(), name))) return missingKey(name).message;
  return null;
}

const NO_PROFILE = { areas: [], pubs: [] };

/**
 * Scores the unscored papers among `ids` in one prompt; returns the AI calls made. A reply without the scores is asked
 * again once, then the papers stay unscored. Provider and network errors throw.
 */
export async function scoreBatch(ids: number[]): Promise<number> {
  'use step';
  const sql = getSql();
  const store = readingStore();
  const papers = (await getPapers(sql, ids)).filter((p) => p.score === null);
  if (!papers.length) return 0;
  const [prefs, ai, profile] = await Promise.all([
    readPrefs(),
    readAiConfig(store),
    readProfile(store).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[reading] profile', e);
      return NO_PROFILE;
    }),
  ]);
  // The titles `related` may name are exactly those the prompt lists.
  const listed = { ...profile, pubs: profile.pubs.slice(0, MAX_PAPERS) };
  const prompt = scorePrompt(papers, profileText(prefs, listed));
  const asked = papers.map((p) => p.id);
  for (let calls = 1; ; calls++) {
    const text = await generateText(store, ai, prompt);
    let scores;
    try {
      scores = parseScores(
        text,
        asked,
        listed.pubs.map((p) => p.title),
      );
    } catch {
      if (calls === 2) return calls;
      continue;
    }
    for (const { id, ...s } of scores) await setScore(sql, id, s);
    return calls;
  }
}
// A retry would repeat the AI calls; the workflow stops ranking on a throw.
scoreBatch.maxRetries = 0;

/** Papers people are talking about, from one source, stored with their numbers. Never throws. */
export async function collectTraction(
  id: string,
  day: string,
): Promise<{ id: string; found: number; added: number; error?: string; ids: number[] }> {
  'use step';
  let found = 0;
  try {
    const sql = getSql();
    const prefs = await readPrefs();
    const lookup = await paperLookupFor(readingStore());
    const key = id === 'openalex' ? await getSecret(sql, 'OPENALEX_API_KEY') : undefined;
    const fetched = await fetchTraction(id as (typeof TRACTION_SOURCES)[number], prefs, lookup.get, day, key);
    found = fetched.length;
    const stored = await upsertPapers(sql, fetched);
    return { id, found, added: stored.filter((s) => s.added).length, ids: stored.map((s) => s.id) };
  } catch (e) {
    return { id, found, added: 0, error: sourceMessage(id, e), ids: [] };
  }
}

/** Tonight's highest number per source among `papers` (Bluesky too when asked). */
function maxima(papers: Paper[], bluesky: boolean): Parameters<typeof tractionScore>[1] {
  const max: Record<string, number> = {};
  for (const p of papers) {
    const nums: Record<string, number> = { ...primary(p.signals) };
    if (bluesky && p.signals.bluesky) nums.bluesky = p.signals.bluesky.posts;
    for (const [k, v] of Object.entries(nums)) max[k] = Math.max(max[k] ?? 0, v);
  }
  return max;
}

/** Highest tractionScore first; equals keep their order. */
const byTraction = (papers: Paper[], bluesky: boolean) => {
  const max = maxima(papers, bluesky);
  const score = (s: Signals) => tractionScore(bluesky ? s : { ...s, bluesky: undefined }, max);
  return papers
    .map((p) => ({ p, s: score(p.signals) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
};

/**
 * The talked-about candidates worth an area check: 'new' papers not shown before (a paper shown as talked-about comes
 * back once a number it had then has doubled), with a source number, by those numbers (not Bluesky); the first 3n,
 * at most 40.
 */
export async function tractionShortlist(ids: number[], day: string, n: number): Promise<number[]> {
  'use step';
  const sql = getSql();
  const [papers, shown] = await Promise.all([getPapers(sql, ids), shownBefore(sql, ids, day)]);
  const open = papers.filter((p) => {
    if (p.state !== 'new') return false;
    const s = shown.get(p.id);
    return !s || (s.section === 'talked' && resurfaces(p.signals, s.signals));
  });
  return byTraction(open, false)
    .slice(0, Math.min(3 * n, 40))
    .map((p) => p.id);
}

/** The papers the AI places in the owner's wider area; it can only drop. */
export async function areaFilter(ids: number[]): Promise<number[]> {
  'use step';
  const store = readingStore();
  const [prefs, ai, papers] = await Promise.all([readPrefs(), readAiConfig(store), getPapers(getSql(), ids)]);
  return parseArea(await generateText(store, ai, areaPrompt(papers, prefs.area)), ids);
}
areaFilter.maxRetries = 0;

/** Bluesky post counts, one paper at a time; a failed lookup is skipped. */
export async function blueskyStep(ids: number[], day: string): Promise<void> {
  'use step';
  const sql = getSql();
  const lookup = await paperLookupFor(readingStore());
  for (const p of await getPapers(sql, ids)) {
    let bluesky;
    try {
      bluesky = await blueskyCount(lookup.get, p, day);
    } catch {
      continue;
    }
    if (bluesky) await mergeSignals(sql, p.id, { bluesky });
  }
}

const NOT_RANKED = 'Not ranked tonight';

/**
 * Saves the day's digest: talked-about by their numbers (Bluesky included), in-field by score (none below minScore;
 * a short list is not padded), then the unscored pool papers as not ranked tonight. A paper appears once. Returns
 * the counts (`unranked`: every unscored pool paper left) and the digest papers whose text to prefetch.
 */
export async function saveDigestStep(input: {
  day: string;
  talked: number[];
  pool: number[];
  stopped: boolean;
}): Promise<{ talked: number; inField: number; unranked: number; prefetch: number[] }> {
  'use step';
  const sql = getSql();
  const prefs = await readPrefs();
  const now = new Date();
  const [talkedPapers, pool] = await Promise.all([getPapers(sql, input.talked), getPapers(sql, input.pool)]);
  const items: { paperId: number; section: DigestSection; rank: number; line: string; signals?: Signals }[] = [];
  const used = new Set<number>();
  const add = (section: DigestSection, papers: Paper[], limit: number, line: (p: Paper) => string, keep = false) => {
    let rank = 0;
    for (const p of papers) {
      if (rank === limit) break;
      if (used.has(p.id)) continue;
      used.add(p.id);
      items.push({ paperId: p.id, section, rank: ++rank, line: line(p), ...(keep ? { signals: p.signals } : {}) });
    }
    return rank;
  };
  const talked = add('talked', byTraction(talkedPapers, true), prefs.talked, (p) => signalLine(p.signals, now), true);
  const inField = add(
    'field',
    pool.filter((p) => p.score !== null && p.score >= prefs.minScore).sort((a, b) => b.score! - a.score!),
    prefs.inField,
    reasonLine,
  );
  const unscored = pool.filter((p) => p.score === null && !used.has(p.id));
  add('unranked', unscored, prefs.inField, () => NOT_RANKED);
  await saveDigest(sql, input.day, items);
  return {
    talked,
    inField,
    unranked: unscored.length,
    prefetch: await missingTexts(
      sql,
      items.map((i) => i.paperId),
    ),
  };
}

/** arXiv's HTML full text for one paper, cached privately; a failure is stored too ('404' or its message). */
export async function fetchTextStep(id: number): Promise<boolean> {
  'use step';
  const sql = getSql();
  const [p] = await getPapers(sql, [id]);
  if (!p?.arxiv) return false;
  const site = await readConfig(readingStore(), 'site');
  const siteUrl = typeof site.data.siteUrl === 'string' ? site.data.siteUrl : '';
  let body: string | null = null;
  let error: string | null = null;
  try {
    body = await getText(`https://arxiv.org/html/${p.arxiv}`, {
      maxBytes: 10 * 1024 * 1024,
      headers: { 'User-Agent': siteUrl ? `ScholarOS reading (+${siteUrl})` : 'ScholarOS reading' },
    });
  } catch (e) {
    error = e instanceof SourceError && e.status === 404 ? '404' : (e as Error).message;
  }
  await saveText(sql, id, { source: 'arxiv-html', body, error });
  return body !== null;
}

/** Emails the day's digest when the email is on; the result goes in the run summary. Never throws. */
export async function emailStep(day: string): Promise<string> {
  'use step';
  return sendReadingDigest(getSql(), day);
}
// A retry could send the email twice.
emailStep.maxRetries = 0;

export async function finishReading(run: ReadingRun): Promise<void> {
  'use step';
  await writeReading(getSql(), { lastRun: run }, BOT.name);
}
