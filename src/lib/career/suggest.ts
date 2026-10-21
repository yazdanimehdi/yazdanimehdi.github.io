// Job-search settings suggested from the owner's own site: the AI reads the CV and publications for prefs; locations
// and contact answers are copied from the CV in code.
import type { TextInput } from '../ai/providers';
import type { CvConfig } from '../types';
import { networkUrl, phoneOf } from './answers';
import { jsonObject } from './prompts';
import type { ApplicationAnswers, CareerPrefs } from './settings';
import { visible } from './text';

export type Suggestion = Pick<CareerPrefs, 'roles' | 'keywords' | 'seniority' | 'fields' | 'languages'>;

const MAX_PAPERS = 40;
const MAX_ITEMS = 8;
const LISTS = ['roles', 'keywords', 'seniority', 'fields'] as const;

export function suggestPrompt(
  cvText: string,
  papers: { title: string; topic?: string; abstract?: string }[],
): TextInput {
  const list = papers
    .slice(0, MAX_PAPERS)
    .map((p) =>
      [`- ${p.title}`, p.topic && `  Topic: ${p.topic}`, p.abstract && `  Abstract: ${p.abstract.slice(0, 200)}`]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
  return {
    system: [
      'You suggest job-search settings for a candidate from their own CV and publications.',
      'Use only what that material says: never invent roles, skills or languages it does not support.',
      'Reply with JSON only: {"roles":[string],"keywords":[string],"seniority":[string],"fields":[string],"languages":[{"language":string,"level":string}]}.',
      'At most 8 short items per list. roles: job titles the candidate fits; keywords: skills and methods to search for; seniority: levels such as "Senior" or "Postdoc"; fields: research or industry fields; languages: spoken languages with the level the CV gives. Leave a list empty when the material does not say.',
    ].join(' '),
    prompt: [`Candidate CV:\n${cvText}`, list && `Candidate publications:\n${list}`].filter(Boolean).join('\n\n'),
    maxTokens: 1500,
  };
}

const clean = (v: unknown) => (typeof v === 'string' ? visible(v).trim() : '');
const fits = (s: string) => s.length >= 1 && s.length <= 60;

/** Keeps the first of each case-insensitive key, at most 8. */
function firstEight<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of items) {
    const k = key(t).toLowerCase();
    if (seen.has(k) || out.length === MAX_ITEMS) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

const MESSAGE = 'The model did not return the settings it was asked for';

/** Each list cleaned (`visible`, trimmed, 1–60 characters), deduped case-insensitively and capped at 8; throws otherwise. */
export function parseSuggestion(text: string): Suggestion {
  const r = jsonObject(text, MESSAGE);
  for (const k of [...LISTS, 'languages'] as const) if (!Array.isArray(r[k])) throw new Error(MESSAGE);
  const strings = (k: (typeof LISTS)[number]) => firstEight((r[k] as unknown[]).map(clean).filter(fits), (s) => s);
  const languages = (r.languages as unknown[])
    .map((l) => (l && typeof l === 'object' ? (l as Record<string, unknown>) : {}))
    .map((l) => ({ language: clean(l.language), level: clean(l.level) }))
    .filter((l) => fits(l.language) && l.level.length <= 60);
  return {
    roles: strings('roles'),
    keywords: strings('keywords'),
    seniority: strings('seniority'),
    fields: strings('fields'),
    languages: firstEight(languages, (l) => l.language),
  };
}

const isHttp = (url: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

/** The CV's contact location as the one suggested location; no AI (past places on the CV would filter postings out). */
export function cvLocations(cv: CvConfig): string[] {
  const l = cv.cv.location?.trim();
  return l ? [l] : [];
}

/** Phone, address and links copied from the CV; no AI. */
export function contactAnswers(cv: CvConfig): Pick<ApplicationAnswers, 'phone' | 'address' | 'links'> {
  const c = cv.cv;
  const links = [
    ...(c.socialNetworks ?? [])
      .filter((s) => s.network?.trim() && s.username?.trim())
      .map((s) => ({ label: s.network.trim(), url: networkUrl(s.network.trim(), s.username.trim()) })),
    ...(c.website?.trim() ? [{ label: 'Website', url: c.website.trim() }] : []),
  ].filter((l) => isHttp(l.url));
  return { phone: phoneOf(c.phone), address: c.location?.trim() ?? '', links };
}
