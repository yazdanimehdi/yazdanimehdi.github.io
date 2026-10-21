/**
 * A GitHub profile snapshot for the Repositories page: src/data/github.json, refreshed by the daily job (Postgres
 * mode) or `pnpm sync:github`. Two public API calls; GITHUB_TOKEN, when set, only raises the rate limit.
 */

export const GITHUB_JSON = 'src/data/github.json';

export interface GitHubRepo {
  name: string;
  description: string | null;
  url: string;
  homepage: string | null;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  pushedAt: string;
  fork: boolean;
  archived: boolean;
}

export interface GitHubSnapshot {
  username: string;
  followers: number;
  createdAt: string;
  repos: GitHubRepo[];
}

export type FetchJson = (url: string) => Promise<unknown>;

const API = 'https://api.github.com';

const fetchJson: FetchJson = async (url) => {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ScholarOS GitHub sync',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url.replace(API, '')}`);
  return res.json();
};

type ApiRepo = {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  pushed_at: string;
  fork: boolean;
  archived: boolean;
};

// ponytail: the first 100 repositories only; page through them if a profile ever has more.
export async function fetchGitHub(username: string, get: FetchJson = fetchJson): Promise<GitHubSnapshot> {
  const user = encodeURIComponent(username);
  const [profile, repos] = (await Promise.all([
    get(`${API}/users/${user}`),
    get(`${API}/users/${user}/repos?per_page=100&type=owner&sort=pushed`),
  ])) as [{ followers: number; created_at: string }, ApiRepo[]];
  return {
    username,
    followers: profile.followers,
    createdAt: profile.created_at,
    repos: repos.map((r) => ({
      name: r.name,
      description: r.description,
      url: r.html_url,
      homepage: r.homepage || null,
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language,
      topics: r.topics ?? [],
      pushedAt: r.pushed_at,
      fork: r.fork,
      archived: r.archived,
    })),
  };
}

/** The file's contents: the same snapshot always writes the same bytes, so an unchanged profile commits nothing. */
export const snapshotJson = (s: GitHubSnapshot) => `${JSON.stringify(s, null, 2)}\n`;

/** The snapshot as the page reads it: null when missing, unreadable, or for another account. */
export function parseSnapshot(text: string | null, username: string): GitHubSnapshot | null {
  try {
    const s = text ? (JSON.parse(text) as GitHubSnapshot) : null;
    return s && s.username?.toLowerCase() === username.toLowerCase() && Array.isArray(s.repos) ? s : null;
  } catch {
    return null;
  }
}

export interface GitHubSummary {
  totals: { stars: number; forks: number; repos: number; followers: number; since: number };
  /** Main language of each of your own repositories, as shares; the tail folds into "Other". */
  languages: { name: string; count: number; share: number }[];
  pinned: GitHubRepo[];
  recent: GitHubRepo[];
}

/**
 * Your own (not forked) repositories' totals and languages, the pinned ones' details, and the five last pushed
 * (never the profile README repository, named for the account).
 */
export function summarize(s: GitHubSnapshot, pinned: string[], topLanguages = 5): GitHubSummary {
  const own = s.repos.filter((r) => !r.fork);
  const counts = new Map<string, number>();
  for (const r of own) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const tail = ranked.slice(topLanguages).reduce((a, [, n]) => a + n, 0);
  const languages = [...ranked.slice(0, topLanguages), ...(tail ? [['Other', tail] as [string, number]] : [])].map(
    ([name, count]) => ({ name, count, share: count / total }),
  );
  const byName = new Map(s.repos.map((r) => [r.name.toLowerCase(), r]));
  const pinnedRepos = pinned.flatMap((name) => byName.get(name.toLowerCase()) ?? []);
  const isPinned = new Set(pinnedRepos.map((r) => r.name));
  return {
    totals: {
      stars: own.reduce((a, r) => a + r.stars, 0),
      forks: own.reduce((a, r) => a + r.forks, 0),
      repos: own.length,
      followers: s.followers,
      since: new Date(s.createdAt).getUTCFullYear(),
    },
    languages,
    pinned: pinnedRepos,
    recent: own
      .filter((r) => !r.archived && !isPinned.has(r.name) && r.name.toLowerCase() !== s.username.toLowerCase())
      .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
      .slice(0, 5),
  };
}
