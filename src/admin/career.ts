import type { PostingSummary, RunSummary } from '../lib/career/types';

export interface FeedGroups {
  matches: PostingSummary[];
  below: PostingSummary[];
  gated: PostingSummary[];
  unscored: PostingSummary[];
}

/** Matches are scored at or over the threshold and ungated; the rest stay visible in collapsed sections. */
export function groupFeed(rows: PostingSummary[], threshold: number): FeedGroups {
  const g: FeedGroups = { matches: [], below: [], gated: [], unscored: [] };
  for (const r of rows) {
    if (r.gate) g.gated.push(r);
    else if (r.score === null) g.unscored.push(r);
    else (r.score >= threshold ? g.matches : g.below).push(r);
  }
  return g;
}

export interface RunStatus {
  runId: string | null;
  status: string | null;
  lastRun: RunSummary | null;
}

/** Still working: poll until it isn't. */
export const isRunning = (status: string | null) => status === 'running' || status === 'pending';

export { visible } from '../lib/career/text';

/** The URL when it is http(s), else null: only those become links. */
export function httpUrl(u: string | null | undefined): string | null {
  try {
    return u && /^https?:$/.test(new URL(u).protocol) ? u : null;
  } catch {
    return null;
  }
}
