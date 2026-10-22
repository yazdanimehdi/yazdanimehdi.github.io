import type { DashboardData, Run, RunName } from '../../status';
import { listEntries, readConfig } from '../../../lib/admin/content';
import { waitingForReview } from '../../../lib/admin/editor';
import { GitHubStore, type WorkflowRun } from '../../../lib/admin/github-store';
import { json, route } from '../../../lib/admin/http';
import { parseJobs } from '../../../lib/admin/jobs';
import type { ContentStore } from '../../../lib/admin/store';
import { adminSettings, canPublish, isOwner } from '../../../lib/admin/settings';
import { CV_JSON, FEEDS_JSON, JOBS_JSON, SCHOLAR_JSON, collectionDir, configPath } from '../../../lib/admin/paths';
import { readyPostings } from '../../../lib/career/db';
import { readCvMeta } from '../../../lib/cv-pdf/generate';
import { getSql } from '../../../lib/db';
import { feedSources, type FeedsConfig } from '../../../lib/feeds';
import { getMode, type Mode } from '../../../lib/mode';
import { postStatus } from '../../../lib/utils';

export const prerender = false;

/** git mode: the GitHub Actions workflow behind each automated concern. */
const WORKFLOWS: [RunName, string][] = [
  ['papers', 'sync-scholar.yml'],
  ['cv', 'render-cv.yml'],
  ['feeds', 'sync-feeds.yml'],
  ['scheduled', 'release-scheduled.yml'],
];

const toRun = (r: WorkflowRun): Run => ({
  ok: r.status === 'completed' ? r.conclusion === 'success' : null,
  at: r.createdAt,
  url: r.url,
});

function jsonField(content: string | undefined, key: string): unknown {
  try {
    return JSON.parse(content ?? 'null')?.[key];
  } catch {
    return undefined;
  }
}

/** GitHub's answer when the token may not read a workflow's runs (401, 403, 404), else null. */
const refusal = (e: unknown) =>
  [401, 403, 404].includes((e as { githubStatus?: number }).githubStatus ?? 0) ? (e as Error).message : null;

/**
 * git mode: latest workflow runs. One the token can't read is reported in `hiddenRuns` (the row says which permission
 * is missing); any other failure leaves that run unknown instead of failing the dashboard.
 */
async function workflowRuns(gh: GitHubStore): Promise<Pick<DashboardData, 'runs' | 'hiddenRuns'>> {
  const runs: DashboardData['runs'] = {};
  const hiddenRuns: DashboardData['hiddenRuns'] = {};
  await Promise.all(
    WORKFLOWS.map(async ([name, file]) => {
      try {
        const run = await gh.latestRun(file);
        if (run) runs[name] = toRun(run);
      } catch (e) {
        const why = refusal(e);
        if (why) hiddenRuns[name] = why;
      }
    }),
  );
  return { runs, hiddenRuns };
}

/** The newest valid front-matter `date` among published entries, as written (a bare YYYY-MM-DD stays a calendar day). */
function newestDate(entries: { data: Record<string, unknown> }[]): string | null {
  const dates = entries
    .filter((e) => postStatus(e.data) === 'Published')
    .map((e) => String(e.data.date ?? ''))
    .filter((d) => !Number.isNaN(Date.parse(d)));
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

/** Postgres keeps an edit time per document; git would cost one GitHub request per profile, so it reports none. */
async function peopleEdits(store: ContentStore, mode: Mode): Promise<DashboardData['people']> {
  const files = (await store.list(collectionDir('people'))).filter((f) => /\.mdx?$/.test(f.path));
  if (mode !== 'postgres') return { count: files.length, edited: null };
  const times = await Promise.all(files.map((f) => store.lastModified(f.path)));
  return { count: files.length, edited: times.filter((t): t is string => !!t) };
}

export const GET = route(async (_ctx, store, user) => {
  const mode = getMode();
  const gh = store instanceof GitHubStore ? store : null;
  const owner = mode === 'postgres' && isOwner(user, adminSettings());
  const [
    posts,
    news,
    people,
    publications,
    feeds,
    feedsJson,
    cvUpdated,
    cvJson,
    lastSync,
    scholar,
    scholarJson,
    jobs,
    runs,
    head,
    review,
    ready,
  ] = await Promise.all([
    listEntries(store, 'posts'),
    listEntries(store, 'announcements'),
    peopleEdits(store, mode),
    store.list(collectionDir('publications')),
    readConfig(store, 'feeds'),
    store.read(FEEDS_JSON),
    store.lastModified(configPath('cv')),
    store.read(CV_JSON),
    store.lastModified(FEEDS_JSON),
    readConfig(store, 'scholar'),
    store.read(SCHOLAR_JSON),
    mode === 'postgres' ? store.read(JOBS_JSON) : null,
    gh ? workflowRuns(gh) : { runs: {}, hiddenRuns: {} },
    gh ? gh.latestCommit().catch(() => null) : null,
    // A call to act, so publishers only.
    canPublish(user, adminSettings()) ? waitingForReview() : [],
    owner ? readyPostings(getSql()) : null,
  ]);
  const items = jsonField(feedsJson?.content, 'length');
  const authors = Array.isArray(scholar.data.authors) ? scholar.data.authors : [];
  const lastRun = jsonField(scholarJson?.content, 'lastRun');
  // Job search is the owner's alone: nobody else learns it exists.
  const { career, ...daily } = jobs ? parseJobs(jobs.content) : {};
  const data: DashboardData = {
    mode,
    posts,
    publications: publications.filter((f) => /\.mdx?$/.test(f.path)).length,
    scholar: {
      configured: authors.some((a) => typeof a?.scholar_id === 'string' && a.scholar_id.trim()),
      lastRun: typeof lastRun === 'string' ? lastRun : null,
    },
    cv: { updated: cvUpdated, generated: readCvMeta(cvJson?.content)?.lastGenerated ?? null },
    feeds: {
      sources: feedSources(feeds.data as FeedsConfig).length,
      items: typeof items === 'number' ? items : 0,
      lastSync,
      ...(feedsJson && typeof items !== 'number' ? { error: `${FEEDS_JSON} is not valid JSON` } : {}),
    },
    news: { count: news.length, latest: newestDate(news) },
    people,
    runs: jobs ? { ...daily, ...(career && owner ? { career } : {}) } : runs.runs,
    hiddenRuns: runs.hiddenRuns,
    lastCommit: head,
    review,
    ...(ready ? { career: { ready: ready.length } } : {}),
  };
  return json(data);
});
