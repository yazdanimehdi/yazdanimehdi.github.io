import { createHash } from 'node:crypto';
import type { CareerPrefs } from './settings';
import type { RawPosting } from './types';

/** NFKD, lowercase, runs of non-alphanumerics collapsed to one space, trimmed. */
export const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Lowercase host; drops the fragment, a trailing `/`, and `utm_*` / `ref` / `source` params. */
export const normalizeUrl = (url: string): string => {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim();
  }
  for (const k of [...u.searchParams.keys()]) {
    if (k.startsWith('utm_') || k === 'ref' || k === 'source') u.searchParams.delete(k);
  }
  u.hash = '';
  return u.origin + u.pathname.replace(/\/$/, '') + u.search;
};

export const postingKey = (p: Pick<RawPosting, 'company' | 'title' | 'url'>): string =>
  createHash('sha256')
    .update(`${fold(p.company)}|${fold(p.title)}|${normalizeUrl(p.url)}`)
    .digest('hex')
    .slice(0, 32);

const hasPhrase = (haystack: string, phrase: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(
    haystack,
  );

/** The reason to skip a posting, or null. Unknown location or salary passes: the scorer judges it. */
export const hardGate = (p: RawPosting, prefs: CareerPrefs): string | null => {
  const company = fold(p.company);
  if (prefs.avoidCompanies.some((c) => fold(c) === company)) return 'company on your avoid list';

  const text = `${p.title}\n${p.description}`;
  const phrase = prefs.dealBreakers.find((d) => d.trim() && hasPhrase(text, d.trim()));
  if (phrase) return `deal-breaker: ${phrase}`;

  if (prefs.remote === 'remote' && p.remote === false) return 'not remote';

  if (p.remote !== true && prefs.locations.length && p.location) {
    const loc = p.location.toLowerCase();
    const match = prefs.locations.some((l) => {
      const want = l.toLowerCase();
      return want && (loc.includes(want) || want.includes(loc));
    });
    if (!match) return 'location';
  }

  const floor = prefs.salaryFloor;
  const max = p.salary?.max;
  if (floor && max !== undefined && p.salary?.currency === floor.currency && p.salary.period === floor.period) {
    if (max < floor.amount) return 'below salary floor';
  }
  return null;
};
