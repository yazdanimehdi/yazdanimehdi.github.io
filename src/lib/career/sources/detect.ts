// Pure on purpose: the admin screens import this, and it must not pull in server modules (http, rss-parser).
export type AtsKind = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters';

const HOSTS: Record<string, AtsKind> = {
  'boards.greenhouse.io': 'greenhouse',
  'job-boards.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever',
  'jobs.ashbyhq.com': 'ashby',
  'apply.workable.com': 'workable',
  'jobs.smartrecruiters.com': 'smartrecruiters',
  'careers.smartrecruiters.com': 'smartrecruiters',
};

/** The board behind a careers URL: its kind and the first path segment as token. */
export function detectAts(url: string): { kind: AtsKind; token: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const kind = Object.hasOwn(HOSTS, host) ? HOSTS[host] : undefined;
  const token = u.pathname.split('/')[1];
  // apply.workable.com/j/<shortcode> is one job, not an account.
  if (!kind || !token || (kind === 'workable' && token === 'j')) return null;
  return { kind, token };
}
