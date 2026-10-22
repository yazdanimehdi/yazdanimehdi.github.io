import type { CareerPrefs } from './settings';
import type { PostingSummary } from './types';

/** How the per-company limit tells companies apart: case and surrounding spaces don't count. */
export const companyKey = (company: string) => company.trim().toLowerCase();

/**
 * Tonight's drafts, best score first: ungated matches at or over the threshold still `found` with no draft, at most
 * `nightly.maxDrafts`, and none for a company whose applications in the window (`counts`, by companyKey) plus those
 * chosen tonight reach `perCompany.max`. `limited` counts the matches either limit held back.
 */
export function draftCandidates(
  matches: PostingSummary[],
  prefs: CareerPrefs,
  counts: Map<string, number>,
): { ids: number[]; limited: number } {
  const { maxDrafts, perCompany } = prefs.nightly;
  const open = matches
    .filter(
      (m) =>
        m.gate === null &&
        m.score !== null &&
        m.score >= prefs.threshold &&
        m.status === 'found' &&
        m.draftState === 'none',
    )
    .sort((a, b) => b.score! - a.score!);
  const chosen = new Map<string, number>();
  const ids: number[] = [];
  let limited = 0;
  for (const m of open) {
    const key = companyKey(m.company);
    const tonight = chosen.get(key) ?? 0;
    if (ids.length >= maxDrafts || (counts.get(key) ?? 0) + tonight >= perCompany.max) {
      limited++;
      continue;
    }
    ids.push(m.id);
    chosen.set(key, tonight + 1);
  }
  return { ids, limited };
}
