// Pure helpers for the day's papers: one key per paper, and keyword overlap to pick what the AI sees.

/** An arXiv id without an `arXiv:` prefix or a version. */
export const normalizeArxiv = (id: string): string =>
  id
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/, '');

/** 'arxiv:<id>' (also for arXiv's own 10.48550 DOIs), else 'doi:<lowercase>', else 'pmid:<n>'; null with none. */
export function paperKey(ids: { arxiv?: string; doi?: string; pmid?: string }): string | null {
  const arxiv = ids.arxiv?.trim() || ids.doi?.trim().match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  if (arxiv) return `arxiv:${normalizeArxiv(arxiv)}`;
  if (ids.doi?.trim()) return `doi:${ids.doi.trim().toLowerCase()}`;
  if (ids.pmid?.trim()) return `pmid:${ids.pmid.trim()}`;
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keyword hits, case-insensitive and whole-word: 2 per keyword in the title, 1 per keyword in the abstract. */
export function overlap(p: { title: string; abstract?: string | null }, keywords: string[]): number {
  return keywords.reduce((sum, k) => {
    if (!k.trim()) return sum;
    const word = new RegExp(`(?<![\\p{L}\\p{N}])${escape(k.trim())}(?![\\p{L}\\p{N}])`, 'iu');
    return sum + (word.test(p.title) ? 2 : 0) + (p.abstract && word.test(p.abstract) ? 1 : 0);
  }, 0);
}

/** The `limit` best by score, highest first; equals keep their order. */
export function topByOverlap<T>(items: T[], score: (t: T) => number, limit = 60): T[] {
  return items
    .map((item) => ({ item, s: score(item) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}
