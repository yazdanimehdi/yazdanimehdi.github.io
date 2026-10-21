import type { Requirement } from '../lib/career/tailor';
import type { RunSummary } from '../lib/career/types';

export interface RunStatus {
  runId: string | null;
  status: string | null;
  lastRun: RunSummary | null;
}

/** Still working: poll until it isn't. */
export const isRunning = (status: string | null) => status === 'running' || status === 'pending';

export { visible } from '../lib/career/text';

export type CoverageState = 'shown' | 'cut' | 'reworded' | 'gap';

export function coverageState(r: Requirement): CoverageState {
  return r.inCv ? 'shown' : r.inBase ? 'cut' : r.evidence ? 'reworded' : 'gap';
}

/** The drafter's evidence ref ("researchExperience 1", 0-based) as a 1-based entry for display; anything else as is. */
export function evidenceLabel(e: string): string {
  const m = /^(\S+) (\d+)$/.exec(e);
  return m ? `${m[1]} entry ${Number(m[2]) + 1}` : e;
}

export function coverageLine(reqs: Requirement[]): string {
  if (!reqs.length) return 'No requirements were listed for this posting.';
  const part = (kind: Requirement['kind']) => {
    const list = reqs.filter((r) => r.kind === kind);
    return { n: list.length, shown: list.filter((r) => coverageState(r) === 'shown').length };
  };
  const req = part('required');
  const pref = part('preferred');
  const gaps = reqs.filter((r) => coverageState(r) === 'gap').length;
  return (
    `Required: ${req.shown} of ${req.n} shown` +
    (pref.n ? ` · preferred: ${pref.shown} of ${pref.n}` : '') +
    (gaps ? ` · ${gaps} not in your CV` : '')
  );
}

/** The URL when it is http(s), else null: only those become links. */
export function httpUrl(u: string | null | undefined): string | null {
  try {
    return u && /^https?:$/.test(new URL(u).protocol) ? u : null;
  } catch {
    return null;
  }
}
