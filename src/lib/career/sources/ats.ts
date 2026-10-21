import type { RawPosting } from '../types';
import { ashby } from './ashby';
import { greenhouse } from './greenhouse';
import { SourceError, type FetchInit } from './http';
import type { Source } from './index';
import { lever } from './lever';
import { smartrecruiters, smartrecruitersDetail } from './smartrecruiters';
import { workable } from './workable';

/** Big employers' boards run past the default 5 MB (Ashby `openai` is 14 MB). */
export const ATS_MAX_BYTES = 25 * 1024 * 1024;

const BOARDS = { greenhouse, lever, ashby, workable, smartrecruiters };
export type AtsKind = keyof typeof BOARDS;

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

export const atsPostings = (kind: AtsKind, token: string, init?: FetchInit): Promise<RawPosting[]> =>
  BOARDS[kind](token, { maxBytes: ATS_MAX_BYTES, ...init });

/** Companies the owner watches that sit on a known board. Other watched URLs are the careers-page source's. */
export const watched: Source = {
  id: 'watched',
  label: 'Watched companies',
  defaultOn: true,
  async search(ctx) {
    const boards = ctx.prefs.watched.map(detectAts).filter((b) => b !== null);
    const results = await Promise.allSettled(boards.map((b) => atsPostings(b.kind, b.token, { siteUrl: ctx.siteUrl })));
    const failed = results.filter((r) => r.status === 'rejected');
    // ponytail: a failing company is dropped while others answer; report it once RunSummary has per-company errors.
    if (failed.length && failed.length === results.length) throw new SourceError(String(failed[0].reason?.message));
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  },
  async detail(p, ctx) {
    const board = detectAts(p.url);
    if (board?.kind !== 'smartrecruiters') return p;
    return smartrecruitersDetail(board.token, p.externalId, { siteUrl: ctx.siteUrl, maxBytes: ATS_MAX_BYTES });
  },
};
