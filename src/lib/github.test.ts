import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGitHub, parseSnapshot, summarize, type GitHubRepo, type GitHubSnapshot } from './github';

const repo = (name: string, over: Partial<GitHubRepo> = {}): GitHubRepo => ({
  name,
  description: null,
  url: `https://github.com/me/${name}`,
  homepage: null,
  stars: 0,
  forks: 0,
  language: null,
  topics: [],
  pushedAt: '2026-01-01T00:00:00Z',
  fork: false,
  archived: false,
  ...over,
});
const snapshot = (repos: GitHubRepo[]): GitHubSnapshot => ({
  username: 'me',
  followers: 7,
  createdAt: '2015-06-01T00:00:00Z',
  repos,
});

test('summarize: totals and languages count your own repositories, never forks', () => {
  const s = summarize(
    snapshot([
      repo('a', { stars: 10, forks: 2, language: 'Python' }),
      repo('b', { stars: 3, language: 'Python' }),
      repo('c', { stars: 1, forks: 1, language: 'TypeScript' }),
      repo('fork', { stars: 500, forks: 90, language: 'C++', fork: true }),
    ]),
    [],
  );
  assert.deepEqual(s.totals, { stars: 14, forks: 3, repos: 3, followers: 7, since: 2015 });
  assert.deepEqual(
    s.languages.map((l) => [l.name, l.count]),
    [
      ['Python', 2],
      ['TypeScript', 1],
    ],
  );
  assert.equal(s.languages[0].share, 2 / 3);
});

test('summarize: languages past the top few fold into Other, and shares sum to 1', () => {
  const langs = ['Python', 'Python', 'Python', 'R', 'R', 'Go', 'C', 'Rust', 'Julia'];
  const s = summarize(snapshot(langs.map((language, i) => repo(`r${i}`, { language }))), [], 3);
  assert.deepEqual(
    s.languages.map((l) => [l.name, l.count]),
    [
      ['Python', 3],
      ['R', 2],
      ['C', 1],
      ['Other', 3],
    ],
  );
  assert.equal(
    s.languages.reduce((a, l) => a + l.share, 0),
    1,
  );
});

test('summarize: pinned keeps the configured order and case; recent skips pinned, archived, forks and the profile README', () => {
  const s = summarize(
    snapshot([
      repo('Me', { pushedAt: '2026-09-01T00:00:00Z' }),
      repo('Old', { pushedAt: '2024-01-01T00:00:00Z' }),
      repo('Pinned', { pushedAt: '2026-05-01T00:00:00Z' }),
      repo('Newest', { pushedAt: '2026-06-01T00:00:00Z' }),
      repo('Gone', { pushedAt: '2026-07-01T00:00:00Z', archived: true }),
      repo('Forked', { pushedAt: '2026-08-01T00:00:00Z', fork: true }),
    ]),
    ['pinned', 'Old', 'missing'],
  );
  assert.deepEqual(
    s.pinned.map((r) => r.name),
    ['Pinned', 'Old'],
  );
  assert.deepEqual(
    s.recent.map((r) => r.name),
    ['Newest'],
  );
});

test('parseSnapshot: null when missing, corrupt, or for another account', () => {
  const s = snapshot([repo('a')]);
  assert.deepEqual(parseSnapshot(JSON.stringify(s), 'ME'), s);
  assert.equal(parseSnapshot(null, 'me'), null);
  assert.equal(parseSnapshot('{', 'me'), null);
  assert.equal(parseSnapshot(JSON.stringify(s), 'someone-else'), null);
});

test('fetchGitHub: maps the profile and repositories, asking only for owned ones', async () => {
  const urls: string[] = [];
  const s = await fetchGitHub('me', async (url) => {
    urls.push(url);
    if (url.endsWith('/users/me')) return { followers: 4, created_at: '2015-06-01T00:00:00Z' };
    return [
      {
        name: 'x',
        description: 'd',
        html_url: 'https://github.com/me/x',
        homepage: '',
        stargazers_count: 5,
        forks_count: 1,
        language: 'Python',
        topics: ['ml'],
        pushed_at: '2026-01-01T00:00:00Z',
        fork: false,
        archived: false,
      },
    ];
  });
  assert.ok(urls.some((u) => u.includes('/users/me/repos?') && u.includes('type=owner')));
  assert.equal(s.followers, 4);
  assert.deepEqual(s.repos[0], {
    name: 'x',
    description: 'd',
    url: 'https://github.com/me/x',
    homepage: null,
    stars: 5,
    forks: 1,
    language: 'Python',
    topics: ['ml'],
    pushedAt: '2026-01-01T00:00:00Z',
    fork: false,
    archived: false,
  });
});
