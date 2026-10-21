import type { RunSummary } from '../lib/career/types';

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
