import { readCareer } from '../career/db';
import { parsePrefs } from '../career/settings';
import { getSql } from '../db';
import { feedSources, syncFeeds, type FeedsConfig } from '../feeds';
import type { FeedItem, SiteConfig } from '../types';
import { becameDue } from '../utils';
import { startNightly } from '../../workflows/career-nightly';
import { readReading } from '../reading/db';
import { parseReadingPrefs } from '../reading/settings';
import { startReading } from '../../workflows/reading-nightly';
import { BACKUP_BRANCH, backupToGit } from './backup';
import { listEntries, readConfig } from './content';
import { GitHubStore, githubConfig } from './github-store';
import { HttpError, commitChanges } from './http';
import { readAiConfig } from './ai';
import { papersDeps, papersDue, papersSummary, syncPapers } from './papers';
import { scheduleLabel } from '../ai/providers';
import { GITHUB_JSON, fetchGitHub, snapshotJson } from '../github';
import { FEEDS_JSON, JOBS_JSON } from './paths';
import type { PostgresStore } from './postgres-store';
import type { CommitResult, ContentStore } from './store';

// Scheduled first: it is cheap and time-sensitive, while feeds can take 15 s per source. Papers and GitHub before the
// backup, so it includes what they wrote. Career and reading only start their workflows, which write nothing backed up.
export const JOBS = ['scheduled', 'feeds', 'papers', 'github', 'career', 'reading', 'backup'] as const;
export type JobName = (typeof JOBS)[number];
export interface StepResult {
  ok: boolean;
  at: string;
  detail?: string;
  url?: string;
}
export type JobsRecord = Partial<Record<JobName, StepResult>>;
export type Steps = Record<JobName, (previous: JobsRecord, now: Date) => Promise<Pick<StepResult, 'detail' | 'url'>>>;

const DAY = 24 * 60 * 60 * 1000;
const BACKUP_AUTHOR = { name: 'ScholarOS backup', email: 'scholaros-backup@users.noreply.github.com' };

const isStep = (v: unknown): v is StepResult => {
  const s = v as Partial<StepResult> | null;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.ok === 'boolean' &&
    typeof s.at === 'string' &&
    !Number.isNaN(Date.parse(s.at)) &&
    (s.detail === undefined || typeof s.detail === 'string') &&
    (s.url === undefined || typeof s.url === 'string')
  );
};

/** jobs.json, keeping only well-formed step records (it is on the admin's write allowlist, so it may be hand-edited). */
export function parseJobs(text: string | undefined): JobsRecord {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  return Object.fromEntries(JOBS.filter((name) => isStep(record[name])).map((name) => [name, record[name]]));
}

/** Runs every step in order; a failing step is recorded and the next one still runs. Results go to jobs.json. */
export async function runJobs(store: ContentStore, steps: Steps, now = new Date()): Promise<JobsRecord> {
  const file = await store.read(JOBS_JSON);
  const previous = parseJobs(file?.content);
  const at = now.toISOString();
  const results: JobsRecord = {};
  for (const name of JOBS) {
    try {
      results[name] = { ok: true, at, ...(await steps[name](previous, now)) };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[jobs] ${name}`, e);
      results[name] = { ok: false, at, detail: e instanceof Error ? e.message : String(e) };
    }
  }
  // ponytail: the cron and "Run now" racing makes the second write conflict (409); the next run records again.
  await store.commit([{ path: JOBS_JSON, content: `${JSON.stringify(results, null, 2)}\n` }], 'Record daily jobs', {
    [JOBS_JSON]: file?.version ?? null,
  });
  return results;
}

/** "Check now" and the daily job: fetch every feed, commit src/data/feeds.json when it changed. */
export async function syncFeedsFile(store: ContentStore): Promise<{
  changed: boolean;
  count: number;
  failed: { source: string; error: string }[];
  commit?: CommitResult;
}> {
  const [config, current] = await Promise.all([readConfig(store, 'feeds'), store.read(FEEDS_JSON)]);
  let existing: FeedItem[] = [];
  try {
    existing = current ? JSON.parse(current.content) : [];
  } catch {
    // A corrupt file counts as empty: the sync below rewrites it with valid JSON.
  }
  // A fresh site has no feeds: nothing to sync is not an error.
  if (feedSources(config.data as FeedsConfig).length === 0)
    return { changed: false, count: existing.length, failed: [] };
  let result;
  try {
    result = await syncFeeds(config.data as FeedsConfig, existing);
  } catch (e) {
    throw new HttpError(502, e instanceof Error ? e.message : String(e));
  }
  const content = JSON.stringify(result.items, null, 2) + '\n';
  const summary = { count: result.items.length, failed: result.failed };
  if (current?.content === content) return { changed: false, ...summary };
  const commit = await commitChanges(store, [{ path: FEEDS_JSON, content }], 'Sync feeds', {
    [FEEDS_JSON]: current?.version ?? null,
  });
  return { changed: true, ...summary, commit };
}

/** The daily job: snapshot the GitHub profile into src/data/github.json when it changed (the Repositories page). */
export async function syncGitHubFile(
  store: ContentStore,
  username: string,
): Promise<{ changed: boolean; repos: number }> {
  const [snapshot, current] = await Promise.all([fetchGitHub(username), store.read(GITHUB_JSON)]);
  const content = snapshotJson(snapshot);
  if (current?.content === content) return { changed: false, repos: snapshot.repos.length };
  await commitChanges(store, [{ path: GITHUB_JSON, content }], 'Sync GitHub profile', {
    [GITHUB_JSON]: current?.version ?? null,
  });
  return { changed: true, repos: snapshot.repos.length };
}

/** The release window starts at the last successful run; after a failed one, a week back (purging twice is harmless). */
export function releaseSince(previous: StepResult | undefined, now: Date): Date {
  if (previous?.ok) return new Date(previous.at);
  return new Date(now.getTime() - (previous ? 7 : 1) * DAY);
}

/** Posts whose date passed in (since, now]: purge the listings (home, blog, tags, RSS, sitemap) and their own pages. */
export async function releaseScheduled(store: PostgresStore, since: Date, now: Date): Promise<string[]> {
  const due = (await listEntries(store, 'posts'))
    .filter((p) => becameDue({ data: p.data as { draft?: boolean; date: string } }, since, now))
    .map((p) => p.slug);
  if (due.length) await store.purgeTags(['col:posts', ...due.map((slug) => `doc:posts/${slug}`)]);
  return due;
}

/** The daily cron's steps (Postgres mode). `nightly` starts the job search run, `reading` the paper digest; tests pass their own. */
export function dailySteps(
  store: PostgresStore,
  nightly = () => startNightly(getSql()),
  reading = () => startReading(getSql()),
): Steps {
  return {
    feeds: async () => {
      const config = await readConfig(store, 'feeds');
      if (feedSources(config.data as FeedsConfig).length === 0) return { detail: 'no feeds configured' };
      const r = await syncFeedsFile(store);
      const failed = r.failed.map((f) => `${f.source}: ${f.error}`).join('; ');
      return {
        detail: `${r.changed ? 'updated' : 'no new items'} · ${r.count} items${failed ? ` · failed: ${failed}` : ''}`,
      };
    },
    scheduled: async (previous, now) => {
      const due = await releaseScheduled(store, releaseSince(previous.scheduled, now), now);
      return { detail: due.length ? `released ${due.join(', ')}` : 'nothing due' };
    },
    papers: async (_previous, now) => {
      const schedule = (await readAiConfig(store)).papers.schedule;
      if (!papersDue(schedule, now)) return { detail: `not due (${scheduleLabel(schedule)})` };
      const deps = await papersDeps(store);
      if (!deps) return { detail: 'skipped: no SERPAPI_KEY' };
      return { detail: papersSummary(await syncPapers(store, deps, now)) };
    },
    github: async () => {
      const username = ((await readConfig(store, 'site')).data.github as SiteConfig['github'])?.username;
      if (!username) return { detail: 'skipped: no GitHub username' };
      const r = await syncGitHubFile(store, username);
      return { detail: `${r.changed ? 'updated' : 'unchanged'} · ${r.repos} repositories` };
    },
    // Every admin sees jobs.json (the dashboard, db:export): the detail never says whether a search is set up or ran.
    // The real state is the owner-only career_settings (last_run, run_id).
    career: async () => {
      try {
        const prefs = parsePrefs((await readCareer(getSql())).prefs);
        const terms = [...prefs.roles, ...prefs.keywords].filter((t) => t.trim());
        if (terms.length || prefs.watched.length || prefs.feeds.length) await nightly();
      } catch (e) {
        // runJobs logs the cause and records only the message.
        throw new Error('failed', { cause: e });
      }
      return { detail: 'done' };
    },
    // Like career: always 'done'. Bluesky only adds counts to papers found elsewhere, so it alone is no digest.
    reading: async () => {
      try {
        const { sources } = parseReadingPrefs((await readReading(getSql())).prefs);
        if (Object.entries(sources).some(([id, s]) => id !== 'bluesky' && s.on)) await reading();
      } catch (e) {
        throw new Error('failed', { cause: e });
      }
      return { detail: 'done' };
    },
    backup: async (_previous, now) => {
      if (!process.env.GITHUB_TOKEN) return { detail: 'skipped: no GITHUB_TOKEN' };
      const gh = new GitHubStore({ ...githubConfig(process.env), branch: BACKUP_BRANCH }, BACKUP_AUTHOR);
      const result = await backupToGit(getSql(), gh, now);
      return { detail: `${result.changed ?? 0} file(s) changed`, ...(result.commit ? { url: result.commit } : {}) };
    },
  };
}
