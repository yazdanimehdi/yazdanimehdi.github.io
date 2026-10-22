import { visible } from '../lib/career/text';
import { postStatus } from '../lib/utils';
import { formatDate } from './dates';
import type { Entry } from './types';

/** An automated job's latest run: a daily job (Postgres) or a GitHub Actions workflow (git). `ok: null` = still running. */
export interface Run {
  ok: boolean | null;
  at: string;
  url?: string;
  detail?: string;
}
export type RunName = 'papers' | 'cv' | 'feeds' | 'scheduled' | 'career' | 'reading' | 'backup';

/** GET /api/admin/dashboard: what the server can honestly know about the site's automation and content. */
export interface DashboardData {
  mode: 'static' | 'git' | 'postgres';
  posts: Entry[];
  publications: number;
  scholar: { configured: boolean; lastRun: string | null };
  cv: { updated: string | null; generated: string | null };
  feeds: { sources: number; items: number; lastSync: string | null; error?: string };
  /** News items and the date of the newest one. */
  news: { count: number; latest: string | null };
  /** Profiles, and each one's last edit; `edited` is null where the store can't say cheaply (git mode). */
  people: { count: number; edited: string[] | null };
  runs: Partial<Record<RunName, Run>>;
  /** git mode: workflows whose runs the GitHub token may not read, with GitHub's answer. */
  hiddenRuns: Partial<Record<RunName, string>>;
  /** git mode: the branch head, which Vercel deploys. */
  lastCommit: { at: string; url: string } | null;
  /** Publishers only: who asked for Site editor changes that wait for review (empty: none, or not a publisher). */
  review: string[];
  /** The job-search owner in Postgres mode: postings waiting for approval, and why the last run stopped early. */
  career?: { ready: number; stopped?: string };
  /** The reading owner in Postgres mode: how many papers today's digest holds, and why ranking stopped if it did. */
  reading?: { today: number; stopped?: string };
}

/**
 * attention: broken, needs fixing. nudge: an editorial suggestion, never a problem. unseen: set up, but the GitHub
 * token can't read its runs, so nobody can say. unknown: set up but never seen running. off: not set up, which is a
 * choice, not a problem.
 */
export type Tone = 'ok' | 'attention' | 'nudge' | 'unseen' | 'unknown' | 'off';
/** What a row's button runs in place, through the matching admin API endpoint. */
export type RunKind = 'sync-feeds' | 'run-jobs' | 'sync-papers' | 'render-cv';
export type Action =
  | { kind: 'screen'; label: string; path: string }
  | { kind: 'external'; label: string; url: string }
  | { kind: RunKind; label: string };
export interface StatusRow {
  key: string;
  label: string;
  state: string;
  tone: Tone;
  at: string | null;
  detail?: string;
  /** The failure exactly as the job reported it, when `detail` is a plain-language version of it. */
  raw?: string;
  action?: Action;
  /** A secondary link next to an in-place action, e.g. the failed GitHub Actions run. */
  link?: { label: string; url: string };
}

/** No news for this long and the site starts to look abandoned; about one academic term. */
export const NEWS_STALE_DAYS = 183;
/** A profile untouched this long likely lists an old role, title or photo. */
export const PROFILE_STALE_DAYS = 365;
const DAY = 24 * 3600 * 1000;

const screen = (label: string, path: string): Action => ({ kind: 'screen', label, path });
const external = (label: string, url?: string): Action | undefined =>
  url ? { kind: 'external', label, url } : undefined;
const viewRun = (url?: string) => (url ? { label: 'View run', url } : undefined);
const viewOn = (url?: string) => (url ? { label: 'View on GitHub', url } : undefined);
const SYNC_FEEDS: Action = { kind: 'sync-feeds', label: 'Sync all feeds' };
const RETRY_FEEDS: Action = { kind: 'sync-feeds', label: 'Retry' };
const CHECK_SCHOLAR: Action = { kind: 'sync-papers', label: 'Check now' };
const RETRY_SCHOLAR: Action = { kind: 'sync-papers', label: 'Retry' };
const NEW_NEWS = screen('New news item', 'content/announcements?new');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const latest = (...times: (string | null | undefined)[]) =>
  times.filter((t): t is string => !!t).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
const skipped = (run?: Run) => run?.detail?.startsWith('skipped:') ?? false;

/** What fixes a failure: the settings that hold its key, waiting for the next automatic run, or trying again. */
type Fix = 'settings' | 'wait' | 'retry';

/** Known failure texts in plain words; `then` says what happens next. Unknown failures stay as reported. */
const FAILURES: [RegExp, Fix, (service: string, then: string) => string][] = [
  [/ is not set/, 'settings', (s) => `${s} needs a key`],
  [/\b429\b|rate.?limit|too many requests/i, 'wait', (s, then) => `${s} is rate-limiting${then}`],
  [/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key/i, 'settings', (s) => `${s} refused the request`],
  [/ETIMEDOUT|ENOTFOUND|ECONNRE|fetch failed|timed? ?out/i, 'retry', (s, then) => `${s} could not be reached${then}`],
  // A status code, not any three digits: "HTTP 503", "SerpApi answered 502", "GitHub error 500".
  [/\b(?:HTTP|answered|error)\s*5\d\d\b/i, 'retry', (s, then) => `${s} had a temporary problem${then}`],
];

/**
 * The known reading of `raw`, or undefined. Feed sync joins one failure per feed with "; ". When those need
 * different fixes ("Medium: HTTP 403; Blog: HTTP 500") there is no one reading: a settings link would leave the
 * other feed broken, so the text stays as reported, with Retry.
 */
function diagnose(raw: string) {
  const hits = raw
    .split('; ')
    .map((part) => FAILURES.find(([re]) => re.test(part)))
    .filter((hit) => hit !== undefined);
  return new Set(hits.map(([, fix]) => fix)).size === 1 ? hits[0] : undefined;
}

/** "Google Scholar is rate-limiting. Next automatic try: tomorrow", or null for a failure with no known meaning. */
export function plainFailure(raw: string, service: string, then = ''): string | null {
  const hit = diagnose(raw);
  return hit ? hit[2](service, then) : null;
}

/** The GitHub token has no admin screen: it is a Vercel environment variable. */
export const TOKEN_HELP = 'Check GITHUB_TOKEN in your Vercel project (Settings → Environment Variables), then redeploy';

interface Recovery {
  /** Where the failing service's key lives: an admin screen, or a sentence for keys set outside the admin. */
  settings: Action | string;
  /** Runs the job again in place; omitted where only the daily run retries it. */
  retry?: Action;
  /** What happens next on its own, appended to the plain sentence. */
  then?: string;
}

/** A failed row's detail and the action that fits the diagnosis; the job's own words stay in `raw`. */
export function failure(
  raw: string | undefined,
  service: string,
  { settings, retry, then = '' }: Recovery,
): Pick<StatusRow, 'detail' | 'raw' | 'action'> {
  if (!raw) return { action: retry };
  const hit = diagnose(raw);
  if (!hit) return { detail: raw, action: retry };
  const plain = hit[2](service, then);
  if (hit[1] === 'wait') return { detail: plain, raw };
  if (hit[1] === 'retry') return { detail: plain, raw, action: retry };
  const where = /GITHUB_TOKEN/.test(raw) ? TOKEN_HELP : settings;
  return typeof where === 'string' ? { detail: `${plain}. ${where}`, raw } : { detail: plain, raw, action: where };
}
const DAILY = '. Next automatic try: tomorrow';
const API_KEYS = screen('API keys', 'ai#keys');

/** The `unknown` row as it stands, or, when the token can't read the workflow's runs, a row that says so and why. */
function unseen(d: DashboardData, name: RunName, row: StatusRow): StatusRow {
  const raw = d.hiddenRuns[name];
  if (!raw) return row;
  const detail = `The GitHub token needs Actions: Read and write access to show them. ${TOKEN_HELP}`;
  return { ...row, state: 'Can’t see its GitHub runs', tone: 'unseen', detail, raw };
}

function papers(d: DashboardData): StatusRow {
  const row = { key: 'papers', label: 'Publications' };
  const run = d.runs.papers;
  const count = `${plural(d.publications, 'publication')} on the site`;
  if (run?.ok === null) return { ...row, state: 'Syncing with Google Scholar', tone: 'ok', at: run.at };
  if (run?.ok === false) {
    return {
      ...row,
      state: 'Scholar sync failed',
      tone: 'attention',
      at: run.at,
      ...failure(run.detail, 'Google Scholar', { settings: API_KEYS, retry: RETRY_SCHOLAR, then: DAILY }),
      link: viewRun(run.url),
    };
  }
  if (!d.scholar.configured || skipped(run)) {
    const detail = skipped(run) ? run!.detail!.replace(/^skipped:\s*/, 'Skipped: ') : count;
    return {
      ...row,
      state: 'Scholar sync not set up',
      tone: 'off',
      at: null,
      detail,
      action: screen('Scholar settings', 'ai#scholar'),
    };
  }
  const at = latest(run?.at, d.scholar.lastRun);
  if (!at) return unseen(d, 'papers', { ...row, state: count, tone: 'unknown', at, action: CHECK_SCHOLAR });
  return { ...row, state: 'Synced with Google Scholar', tone: 'ok', at, detail: run?.detail ?? count };
}

function cv(d: DashboardData): StatusRow {
  const row = { key: 'cv', label: 'CV PDF' };
  const run = d.runs.cv;
  const { generated, updated } = d.cv;
  if (run?.ok === null) return { ...row, state: 'Building the PDF', tone: 'ok', at: run.at };
  if (run?.ok === false) {
    return {
      ...row,
      state: 'PDF build failed',
      tone: 'attention',
      at: run.at,
      ...failure(run.detail, 'The PDF builder', { settings: TOKEN_HELP, retry: { kind: 'render-cv', label: 'Retry' } }),
      link: viewRun(run.url),
    };
  }
  if (!generated)
    return unseen(d, 'cv', {
      ...row,
      state: 'No PDF yet',
      tone: 'unknown',
      at: null,
      action: { kind: 'render-cv', label: 'Generate PDF' },
    });
  if (updated && Date.parse(updated) > Date.parse(generated)) {
    return {
      ...row,
      state: 'PDF is older than the CV',
      tone: 'attention',
      at: generated,
      detail: `CV edited ${formatDate(updated)}`,
      action: { kind: 'render-cv', label: 'Regenerate PDF' },
    };
  }
  return { ...row, state: 'Up to date', tone: 'ok', at: generated };
}

function feeds(d: DashboardData): StatusRow {
  const row = { key: 'feeds', label: 'Feeds' };
  const { sources, items, lastSync, error } = d.feeds;
  const run = d.runs.feeds;
  const settings = screen('Feed settings', 'settings#feeds');
  if (!sources) {
    // Posts imported before the feeds were removed stay on the site; say so instead of implying there are none.
    const detail = items ? `${plural(items, 'imported post')} still on the site; they no longer update` : undefined;
    return { ...row, state: 'No feeds set up', tone: 'off', at: lastSync, detail, action: settings };
  }
  if (error)
    return {
      ...row,
      state: 'Feed file unreadable',
      tone: 'attention',
      at: lastSync,
      detail: 'The imported posts file is damaged; syncing rewrites it',
      raw: error,
      action: RETRY_FEEDS,
    };
  if (run?.ok === null) return { ...row, state: 'Syncing now', tone: 'ok', at: run.at };
  if (run?.ok === false)
    return {
      ...row,
      state: 'Feed sync failed',
      tone: 'attention',
      at: run.at,
      ...failure(run.detail, 'A feed', { settings, retry: RETRY_FEEDS, then: DAILY }),
      link: viewRun(run.url),
    };
  const at = latest(run?.at, lastSync);
  const summary = `${plural(items, 'imported post')} from ${plural(sources, 'feed')}`;
  if (!at) return unseen(d, 'feeds', { ...row, state: summary, tone: 'unknown', at, action: SYNC_FEEDS });
  // The daily job records partial failures in its detail while the run itself succeeds.
  if (run?.detail?.includes('failed:'))
    return {
      ...row,
      state: 'Some feeds failed',
      tone: 'attention',
      at,
      ...failure(run.detail, 'A feed', { settings, retry: RETRY_FEEDS, then: DAILY }),
    };
  return { ...row, state: 'Synced', tone: 'ok', at, detail: summary, action: SYNC_FEEDS };
}

function scheduled(d: DashboardData, now: Date): StatusRow {
  const row = { key: 'scheduled', label: 'Scheduled posts' };
  const run = d.runs.scheduled;
  const dates = d.posts
    .filter((p) => postStatus(p.data, now).startsWith('Scheduled'))
    .map((p) => String(p.data.date))
    .sort();
  const detail = dates.length ? `Next goes live ${formatDate(dates[0].slice(0, 10))}` : undefined;
  if (run?.ok === false) {
    // Postgres retries the release with the daily jobs (the dashboard's Run daily jobs); git links the failed run.
    const fix = failure(run.detail, 'The release job', {
      settings: TOKEN_HELP,
      then: d.mode === 'postgres' ? DAILY : '',
    });
    return {
      ...row,
      state: 'Scheduled release failed',
      tone: 'attention',
      at: run.at,
      ...fix,
      detail: fix.detail ?? detail,
      action: fix.action ?? external('View run', run.url),
    };
  }
  if (run?.ok === null) return { ...row, state: 'Releasing now', tone: 'ok', at: run.at, detail };
  // The release job's time is not this row's news: the next post's date is.
  if (!dates.length) return { ...row, state: 'Nothing scheduled', tone: 'ok', at: null };
  const state = `${dates.length} scheduled`;
  // git mode can't always read the workflow's runs, and none is due before the first post's date anyway.
  if (!run && d.mode === 'postgres')
    return { ...row, state, tone: 'unknown', at: null, detail: `${detail} · release job not run yet` };
  return { ...row, state, tone: 'ok', at: null, detail };
}

function news(d: DashboardData, now: Date): StatusRow {
  const row = { key: 'news', label: 'News' };
  const { count, latest: at } = d.news;
  if (!count || !at) return { ...row, state: 'No news yet', tone: 'off', at: null, action: NEW_NEWS };
  const detail = plural(count, 'news item');
  // A suggestion, not a fault: a quiet term is normal, and sample content trips it on first sign-in.
  if (now.getTime() - Date.parse(at) > NEWS_STALE_DAYS * DAY)
    return { ...row, state: 'No news in over 6 months', tone: 'nudge', at, detail, action: NEW_NEWS };
  return { ...row, state: 'Recent', tone: 'ok', at, detail };
}

function people(d: DashboardData, now: Date): StatusRow {
  const row = { key: 'people', label: 'People' };
  const { count, edited } = d.people;
  if (!count)
    return { ...row, state: 'No profiles yet', tone: 'off', at: null, action: screen('Open People', 'content/people') };
  const state = plural(count, 'profile');
  if (!edited) return { ...row, state, tone: 'ok', at: null, detail: 'Edit dates aren’t tracked in this mode' };
  const old = edited.filter((t) => now.getTime() - Date.parse(t) > PROFILE_STALE_DAYS * DAY).length;
  const detail = old ? `${old} not edited in over a year` : 'All edited in the past year';
  return { ...row, state, tone: 'ok', at: latest(...edited), detail };
}

function backup(d: DashboardData): StatusRow {
  const row = { key: 'backup', label: 'Backup copy' };
  const run = d.runs.backup;
  // Only the daily jobs back up; the dashboard's Run daily jobs is the one control that starts them.
  if (!run) return { ...row, state: 'No backup yet', tone: 'unknown', at: null, detail: 'Runs with the daily jobs' };
  if (run.ok === false)
    return {
      ...row,
      state: 'Backup failed',
      tone: 'attention',
      at: run.at,
      ...failure(run.detail, 'GitHub', { settings: TOKEN_HELP, then: DAILY }),
    };
  if (skipped(run)) return { ...row, state: 'Not set up', tone: 'off', at: run.at, detail: run.detail };
  return { ...row, state: 'Backed up to GitHub', tone: 'ok', at: run.at, detail: run.detail, link: viewOn(run.url) };
}

/**
 * The job search: the owner sees what waits for approval; a run that failed to start, then a night that stopped early,
 * come first. The run's detail stays unread on purpose (every admin reads jobs.json); `career` is only sent to the owner.
 */
function career(d: DashboardData): StatusRow[] {
  const run = d.runs.career;
  if (!run && !d.career) return [];
  const row = { key: 'career', label: 'Job search', at: run?.at ?? null };
  const ready = d.career?.ready ?? 0;
  const review = ready ? { action: screen('Review', 'career?status=ready') } : {};
  if (run?.ok === false)
    return [
      {
        ...row,
        state: 'Job search failed to start',
        tone: 'attention',
        detail: 'Next automatic try: tomorrow',
        ...review,
      },
    ];
  if (!d.career) return [{ ...row, state: 'Checked with the daily jobs', tone: 'ok' }];
  if (d.career.stopped) {
    return [
      {
        ...row,
        state: `Stopped early: ${visible(d.career.stopped)}`,
        tone: 'attention',
        ...(ready ? { detail: `${ready} ready for approval`, ...review } : { action: screen('Open', 'career') }),
      },
    ];
  }
  const state = ready ? `${ready} ready for approval` : 'Nothing waiting';
  return [{ ...row, state, tone: 'ok', ...(run ? { detail: 'Checked with the daily jobs' } : {}), ...review }];
}

/** The owner's paper digest: a run that failed to start, then a night whose ranking stopped, come first. */
function reading(d: DashboardData): StatusRow[] {
  if (!d.reading) return [];
  const run = d.runs.reading;
  const row = { key: 'reading', label: 'Reading', at: run?.at ?? null, action: screen('Open', 'reading') };
  if (run?.ok === false) return [{ ...row, state: 'Reading digest failed to start', tone: 'attention' }];
  if (d.reading.stopped)
    return [{ ...row, state: `Ranking stopped: ${visible(d.reading.stopped)}`, tone: 'attention' }];
  const n = d.reading.today;
  return [{ ...row, state: n ? `${n} paper${n === 1 ? '' : 's'} today` : 'No papers today', tone: 'ok' }];
}

/** Problems first, then suggestions, runs the token can't see, jobs never seen running, the healthy rows and, last, what is not set up. */
const RANK: Record<Tone, number> = { attention: 0, nudge: 1, unseen: 2, unknown: 3, ok: 4, off: 5 };

/** One row per automated concern this deployment mode actually has, plus how current the content is. */
export function siteStatus(d: DashboardData, now = new Date()): StatusRow[] {
  const rows = [papers(d), cv(d), feeds(d), scheduled(d, now), news(d, now), people(d, now)];
  if (d.mode === 'postgres') rows.push(...career(d), ...reading(d), backup(d));
  if (d.lastCommit) {
    rows.push({
      key: 'publish',
      label: 'Site last updated',
      state: 'Latest change saved',
      tone: 'ok',
      at: d.lastCommit.at,
      detail: 'The site rebuilds about a minute after each change',
      link: viewOn(d.lastCommit.url),
    });
  }
  return rows.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

export interface Verdict {
  tone: Exclude<Tone, 'off' | 'unseen'>;
  /** The whole sentence, for the status announcement. */
  text: string;
  /** The sentence before the suggestions clause. */
  lead: string;
  /** The row `lead` is about (the first problem), for a `#row-<key>` link. */
  key?: string;
  /** "N suggestions" and the first suggested row, linked on its own. */
  suggestions?: { text: string; key: string };
}

/** "Publications, CV PDF, and Feeds". */
const names = (rows: StatusRow[]) =>
  new Intl.ListFormat('en', { type: 'conjunction' }).format(rows.map((r) => r.label));

/** Always one verdict: the first problem by name, then the rows nobody can vouch for, then the all-clear; suggestions after. */
export function statusSummary(rows: StatusRow[]): Verdict {
  const of = (tone: Tone) => rows.filter((r) => r.tone === tone);
  const [problems, nudges, unseen, unknown] = [of('attention'), of('nudge'), of('unseen'), of('unknown')];
  const suggestions = nudges.length ? { text: plural(nudges.length, 'suggestion'), key: nudges[0].key } : undefined;
  const verdict = (tone: Verdict['tone'], lead: string, key?: string): Verdict => ({
    tone,
    text: suggestions ? `${lead} · ${suggestions.text}` : lead,
    lead,
    ...(key ? { key } : {}),
    ...(suggestions ? { suggestions } : {}),
  });
  if (problems.length) {
    const more = problems.length > 1 ? ` and ${problems.length - 1} more need attention` : '';
    return verdict('attention', `${problems[0].state}${more}`, problems[0].key);
  }
  const quiet = [
    unseen.length ? `Can’t see GitHub runs for ${names(unseen)}` : '',
    unknown.length ? `Not run yet: ${names(unknown)}` : '',
  ]
    .filter(Boolean)
    .join('. ');
  if (nudges.length) return verdict('nudge', quiet || 'Nothing broken');
  if (quiet) return verdict('unknown', quiet);
  return verdict('ok', 'Everything is up to date');
}

/** The chip class for a post or news status; Published keeps the plain chip. */
export const STATUS_CHIP: Record<string, string> = {
  Scheduled: 'adm-status-scheduled',
  Draft: 'adm-status-draft',
  'News draft': 'adm-status-draft',
};

export interface NextUpItem {
  key: string;
  title: string;
  status: 'Scheduled' | 'Draft' | 'News draft';
  date: string;
  /** The byline, where the front matter names one. */
  author?: string;
  /** Admin path that opens the item. */
  path: string;
}

/** A news item edited in this browser and not yet published; `slug` null for a new one. */
export interface NewsDraft {
  slug: string | null;
  data: Record<string, unknown>;
}

const byline = (data: Record<string, unknown>) =>
  typeof data.author === 'string' && data.author.trim() ? data.author.trim() : undefined;

/** Scheduled posts, soonest first, then post and news drafts, newest first. */
export function nextUp(posts: Entry[], newsDrafts: NewsDraft[] = [], now = new Date()): NextUpItem[] {
  const fromPosts = posts.flatMap((p): NextUpItem[] => {
    const status = postStatus(p.data, now).replace(/ · .*/, '');
    if (status !== 'Scheduled' && status !== 'Draft') return [];
    const date = String(p.data.date ?? '').slice(0, 10);
    return [
      {
        key: `post:${p.slug}`,
        title: String(p.data.title || p.slug),
        status,
        date,
        author: byline(p.data),
        path: `posts/${p.slug}`,
      },
    ];
  });
  const fromNews = newsDrafts.map(
    (n): NextUpItem => ({
      key: `news:${n.slug ?? 'new'}`,
      title: String(n.data.title || n.slug || 'Untitled news item'),
      status: 'News draft',
      date: String(n.data.date ?? '').slice(0, 10),
      author: byline(n.data),
      path: n.slug ? `content/announcements?slug=${encodeURIComponent(n.slug)}` : 'content/announcements?new',
    }),
  );
  const items = [...fromPosts, ...fromNews];
  const soon = items.filter((p) => p.status === 'Scheduled').sort((a, b) => a.date.localeCompare(b.date));
  const drafts = items.filter((p) => p.status !== 'Scheduled').sort((a, b) => b.date.localeCompare(a.date));
  return [...soon, ...drafts];
}
