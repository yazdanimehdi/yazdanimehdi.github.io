import type { SecretName } from '../../admin/secrets';
import type { CareerPrefs } from '../settings';
import { SourceError, type FetchInit } from './http';
import type { SourceContext } from './index';

export const MAX_POSTINGS = 100;

/** Roles and keywords joined into the one query string a search API takes. */
export const queryOf = (p: CareerPrefs) => [...p.roles, ...p.keywords].join(' ');

/** One request per location, at most 3; no locations means one request without. */
export const locationsOf = (p: CareerPrefs): (string | undefined)[] =>
  p.locations.length ? p.locations.slice(0, 3) : [undefined];

/** For boards with no search parameter: keeps postings that mention any role or keyword; no terms keeps all. */
export function matching<T>(p: CareerPrefs, items: T[], text: (item: T) => string): T[] {
  const terms = [...p.roles, ...p.keywords].map((t) => t.trim().toLowerCase()).filter(Boolean);
  return terms.length ? items.filter((i) => terms.some((t) => text(i).toLowerCase().includes(t))) : items;
}

export const fetchInit = (ctx: SourceContext, headers?: Record<string, string>): FetchInit => ({
  siteUrl: ctx.siteUrl,
  headers,
});

export async function requireSecret(ctx: SourceContext, name: SecretName): Promise<string> {
  const value = (await ctx.secret(name))?.trim();
  if (!value) throw new SourceError(`${name} is not set`);
  return value;
}

/** Keys travel in URLs, and http.ts error messages can quote the URL; this keeps them out. */
export async function scrubbed<T>(secrets: string[], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof SourceError)) throw e;
    let message = e.message;
    for (const s of secrets) message = message.replaceAll(s, '***').replaceAll(encodeURIComponent(s), '***');
    throw new SourceError(message);
  }
}
