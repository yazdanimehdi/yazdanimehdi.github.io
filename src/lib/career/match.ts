import { createHash } from 'node:crypto';
import type { CareerPrefs } from './settings';
import { visible } from './text';
import type { RawPosting } from './types';

/** NFKD, accents stripped, lowercase, runs of non-alphanumerics collapsed to one space, trimmed. */
export const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
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
  if (!/^https?:$/.test(u.protocol)) return url.trim();
  for (const k of [...u.searchParams.keys()]) {
    if (k.startsWith('utm_') || k === 'ref' || k === 'source') u.searchParams.delete(k);
  }
  u.hash = '';
  return u.origin + u.pathname.replace(/\/$/, '') + u.search;
};

/**
 * One posting, one key, night after night. A careers page's title is the AI's reading, which can change: its URL alone
 * names it.
 */
export const postingKey = (p: Pick<RawPosting, 'company' | 'title' | 'url'> & { source?: string }): string =>
  createHash('sha256')
    .update(`${fold(p.company)}|${p.source === 'careers-page' ? '' : fold(p.title)}|${normalizeUrl(p.url)}`)
    .digest('hex')
    .slice(0, 32);

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const REMOTE = /\bremote\b/i;

/**
 * A source's posting made safe to key and store, or null when it can't be one (no title or URL): one malformed item
 * must not fail its whole source. Bidi and zero-width characters in a title would reorder the admin UI and split one
 * posting into two keys; a date Postgres can't read is dropped; a "Remote" location with no remote flag is remote.
 */
export function tidyPosting(r: RawPosting): RawPosting | null {
  const title = visible(str(r.title)).trim();
  const url = str(r.url).trim();
  if (!title || !url) return null;
  const location = typeof r.location === 'string' ? visible(r.location) : undefined;
  const posted = typeof r.postedAt === 'string' ? Date.parse(r.postedAt) : NaN;
  const remote = typeof r.remote === 'boolean' ? r.remote : location && REMOTE.test(location) ? true : undefined;
  const { location: _l, postedAt: _p, remote: _r, ...rest } = r;
  return {
    ...rest,
    externalId: str(r.externalId) || url,
    company: visible(str(r.company)),
    title,
    url,
    description: str(r.description),
    ...(location === undefined ? {} : { location }),
    ...(Number.isNaN(posted) ? {} : { postedAt: new Date(posted).toISOString() }),
    ...(remote === undefined ? {} : { remote }),
  };
}

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

  const wanted = prefs.locations.map(fold).filter(Boolean);
  if (p.remote !== true && wanted.length && p.location) {
    const loc = fold(p.location);
    if (loc && !wanted.some((w) => loc.includes(w) || w.includes(loc))) return 'location';
  }

  const floor = prefs.salaryFloor;
  const max = p.salary?.max;
  if (floor && max !== undefined && p.salary?.currency === floor.currency && p.salary.period === floor.period) {
    if (max < floor.amount) return 'below salary floor';
  }
  return null;
};
