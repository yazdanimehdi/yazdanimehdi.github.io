import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_HELP, failure, nextUp, plainFailure, siteStatus, statusSummary, type DashboardData } from './status';

const NOW = new Date('2026-10-18T12:00:00Z');
const post = (slug: string, data: Record<string, unknown>) => ({ slug, data: { title: slug, ...data }, version: 'v' });

const base = (over: Partial<DashboardData> = {}): DashboardData => ({
  mode: 'git',
  posts: [],
  publications: 12,
  scholar: { configured: true, lastRun: '2026-10-17T06:00:00Z' },
  cv: { updated: '2026-10-01T00:00:00Z', generated: '2026-10-02T00:00:00Z' },
  feeds: { sources: 2, items: 30, lastSync: '2026-10-18T08:00:00Z' },
  news: { count: 4, latest: '2026-09-01' },
  people: { count: 3, edited: null },
  runs: {},
  hiddenRuns: {},
  lastCommit: null,
  review: [],
  ...over,
});
const row = (d: DashboardData, key: string) => siteStatus(d, NOW).find((r) => r.key === key)!;
const verdict = (d: DashboardData) => statusSummary(siteStatus(d, NOW));

test('a healthy git site says everything is up to date, with one row per concern', () => {
  const rows = siteStatus(base(), NOW);
  assert.deepEqual(
    rows.map((r) => r.key),
    ['papers', 'cv', 'feeds', 'scheduled', 'news', 'people'],
  );
  assert.deepEqual(statusSummary(rows), {
    tone: 'ok',
    text: 'Everything is up to date',
    lead: 'Everything is up to date',
  });
  assert.deepEqual(
    rows.filter((r) => r.action).map((r) => r.action!.label),
    ['Sync all feeds'],
    'healthy rows drop their routine actions; only the on-demand feed sync stays',
  );
});

test('a failed run needs attention: retry in place first, the run page second', () => {
  const d = base({ runs: { feeds: { ok: false, at: '2026-10-18T08:00:00Z', url: 'https://gh/run/1' } } });
  assert.equal(row(d, 'feeds').tone, 'attention');
  assert.deepEqual(row(d, 'feeds').action, { kind: 'sync-feeds', label: 'Retry' });
  assert.deepEqual(row(d, 'feeds').link, { label: 'View run', url: 'https://gh/run/1' });
  assert.deepEqual(verdict(d), { tone: 'attention', text: 'Feed sync failed', lead: 'Feed sync failed', key: 'feeds' });
});

test('the verdict names the first problem, counts the rest, and links suggestions on their own', () => {
  const d = base({
    cv: { updated: '2026-10-10T00:00:00Z', generated: '2026-10-02T00:00:00Z' },
    runs: { feeds: { ok: false, at: '2026-10-18T08:00:00Z' } },
    news: { count: 3, latest: '2026-03-01' },
  });
  assert.deepEqual(verdict(d), {
    tone: 'attention',
    text: 'PDF is older than the CV and 1 more need attention · 1 suggestion',
    lead: 'PDF is older than the CV and 1 more need attention',
    key: 'cv',
    suggestions: { text: '1 suggestion', key: 'news' },
  });
  const nudgeOnly = base({ news: { count: 3, latest: '2026-03-01' } });
  assert.deepEqual(verdict(nudgeOnly), {
    tone: 'nudge',
    text: 'Nothing broken · 1 suggestion',
    lead: 'Nothing broken',
    suggestions: { text: '1 suggestion', key: 'news' },
  });
});

test('rows sort attention, nudge, unknown, ok, then off', () => {
  const d = base({
    scholar: { configured: false, lastRun: null },
    cv: { updated: '2026-10-10T00:00:00Z', generated: '2026-10-02T00:00:00Z' },
    feeds: { sources: 1, items: 0, lastSync: null },
    news: { count: 3, latest: '2026-03-01' },
  });
  assert.deepEqual(
    siteStatus(d, NOW).map((r) => `${r.key}:${r.tone}`),
    ['cv:attention', 'news:nudge', 'feeds:unknown', 'scheduled:ok', 'people:ok', 'papers:off'],
  );
});

test('a known failure reads as a plain sentence; the job’s own words stay in raw', () => {
  const raw = 'SerpApi answered 429: Your account has run out of searches';
  const d = base({ runs: { papers: { ok: false, at: '2026-10-18T06:00:00Z', detail: raw } } });
  assert.equal(row(d, 'papers').detail, 'Google Scholar is rate-limiting. Next automatic try: tomorrow');
  assert.equal(row(d, 'papers').raw, raw);
  assert.equal(plainFailure('something odd', 'X'), null, 'unknown failures are not reworded');
  const odd = base({ runs: { papers: { ok: false, at: '2026-10-18T06:00:00Z', detail: 'something odd' } } });
  assert.equal(row(odd, 'papers').detail, 'something odd');
  assert.equal(row(odd, 'papers').raw, undefined);
});

test('a failure offers the action that fits its diagnosis', () => {
  const retry = { kind: 'sync-papers', label: 'Retry' } as const;
  const keys = { kind: 'screen', label: 'API keys', path: 'ai#keys' } as const;
  const fix = (raw: string) => failure(raw, 'Google Scholar', { settings: keys, retry, then: '. Next: tomorrow' });
  assert.deepEqual(fix('SERPAPI_KEY is not set: add it on the Integrations screen').action, keys, 'missing key');
  assert.equal(fix('SERPAPI_KEY is not set').detail, 'Google Scholar needs a key');
  assert.deepEqual(fix('HTTP 401 Unauthorized').action, keys, 'refused key');
  assert.equal(fix('429 Too Many Requests').action, undefined, 'a rate limit has no button');
  assert.equal(fix('429 Too Many Requests').detail, 'Google Scholar is rate-limiting. Next: tomorrow');
  assert.deepEqual(fix('fetch failed').action, retry, 'a network blip can be retried');
  assert.deepEqual(fix('something odd').action, retry, 'unknown errors keep Retry');
  const token = fix('GitHub rejected GITHUB_TOKEN (expired or revoked): Bad credentials 401');
  assert.equal(token.action, undefined, 'the token has no screen');
  assert.equal(token.detail, `Google Scholar refused the request. ${TOKEN_HELP}`);
});

test('5xx is read from a status code, not from any three digits', () => {
  const fix = (raw: string) => failure(raw, 'A feed', { settings: 'S', retry: { kind: 'sync-feeds', label: 'Retry' } });
  assert.equal(fix('HTTP 503').detail, 'A feed had a temporary problem');
  assert.equal(fix('SerpApi answered 502: Bad Gateway').detail, 'A feed had a temporary problem');
  assert.equal(fix('GitHub error 500: boom').detail, 'A feed had a temporary problem');
  assert.equal(fix('Feed has 500 items, more than the limit').detail, 'Feed has 500 items, more than the limit');
  assert.equal(plainFailure('Line 512: unexpected token', 'A feed'), null);
});

test('several feed failures that need different fixes stay as reported, with Retry', () => {
  const retry = { kind: 'sync-feeds', label: 'Retry' } as const;
  const settings = { kind: 'screen', label: 'Feeds', path: 'settings#feeds' } as const;
  const fix = (raw: string) => failure(raw, 'A feed', { settings, retry });
  const mixed = 'All 2 feed(s) failed: Medium: HTTP 403; Blog: HTTP 500';
  assert.deepEqual(fix(mixed), { detail: mixed, action: retry });
  assert.equal(plainFailure(mixed, 'A feed'), null);
  const same = 'All 2 feed(s) failed: Medium: HTTP 503; Blog: HTTP 500';
  assert.deepEqual(fix(same), { detail: 'A feed had a temporary problem', raw: same, action: retry });
  assert.deepEqual(
    fix('GitHub refused the request (403: API rate limit exceeded)').action,
    undefined,
    'one failure keeps its first reading',
  );
});

test('a failed backup says where the token lives and leaves retrying to the one Run daily jobs control', () => {
  const d = base({
    mode: 'postgres',
    runs: { backup: { ok: false, at: '2026-10-18T06:00:00Z', detail: 'GitHub answered 403: Resource not accessible' } },
  });
  assert.equal(row(d, 'backup').action, undefined);
  assert.equal(row(d, 'backup').detail, `GitHub refused the request. ${TOKEN_HELP}`);
  const odd = base({ mode: 'postgres', runs: { backup: { ok: false, at: '2026-10-18T06:00:00Z', detail: 'odd' } } });
  assert.equal(row(odd, 'backup').action, undefined);
  const none = base({ mode: 'postgres' });
  assert.equal(row(none, 'backup').action, undefined);
});

test('CV: the PDF actions run in place; an up-to-date PDF needs no action', () => {
  const stale = base({ cv: { updated: '2026-10-10T00:00:00Z', generated: '2026-10-02T00:00:00Z' } });
  assert.equal(row(stale, 'cv').state, 'PDF is older than the CV');
  assert.deepEqual(row(stale, 'cv').action, { kind: 'render-cv', label: 'Regenerate PDF' });
  const none = base({ cv: { updated: null, generated: null } });
  assert.deepEqual(row(none, 'cv').action, { kind: 'render-cv', label: 'Generate PDF' });
  assert.equal(row(base(), 'cv').action, undefined, 'an up-to-date PDF needs nothing');
});

test('nothing known yet: checkable in place, and a verdict that names the rows', () => {
  const d = base({ scholar: { configured: true, lastRun: null }, feeds: { sources: 1, items: 0, lastSync: null } });
  assert.equal(row(d, 'papers').tone, 'unknown');
  assert.equal(row(d, 'papers').state, '12 publications on the site');
  assert.deepEqual(row(d, 'papers').action, { kind: 'sync-papers', label: 'Check now' });
  assert.equal(row(d, 'feeds').tone, 'unknown');
  const text = 'Not run yet: Publications and Feeds';
  assert.deepEqual(verdict(d), { tone: 'unknown', text, lead: text });
  const one = base({ cv: { updated: null, generated: null } });
  assert.equal(verdict(one).text, 'Not run yet: CV PDF');
  const both = { ...d, hiddenRuns: { papers: 'GitHub refused the request (403).' } };
  assert.equal(verdict(both).text, 'Can’t see GitHub runs for Publications. Not run yet: Feeds');
});

test('runs the token can’t read: their own state, naming the permission, never "not run yet"', () => {
  const refused = 'GitHub refused the request (403: Resource not accessible by personal access token).';
  const d = base({
    scholar: { configured: true, lastRun: null },
    cv: { updated: null, generated: null },
    hiddenRuns: { papers: refused, cv: refused, feeds: refused },
  });
  assert.equal(row(d, 'papers').tone, 'unseen');
  assert.equal(row(d, 'papers').state, 'Can’t see its GitHub runs');
  assert.match(row(d, 'papers').detail!, /Actions: Read and write/);
  assert.equal(row(d, 'papers').raw, refused);
  assert.deepEqual(row(d, 'cv').action, { kind: 'render-cv', label: 'Generate PDF' });
  assert.equal(row(d, 'feeds').tone, 'ok', 'a row with its own evidence (the feeds file) is not affected');
  assert.deepEqual(verdict(d), {
    tone: 'unknown',
    text: 'Can’t see GitHub runs for Publications and CV PDF',
    lead: 'Can’t see GitHub runs for Publications and CV PDF',
  });
});

test('Scholar not set up points to its settings instead of claiming to set it up', () => {
  const d = base({ scholar: { configured: false, lastRun: null } });
  assert.equal(row(d, 'papers').tone, 'off');
  assert.deepEqual(row(d, 'papers').action, { kind: 'screen', label: 'Scholar settings', path: 'ai#scholar' });
});

test('no feeds but imported posts left: the row says the posts are still there', () => {
  const d = base({ feeds: { sources: 0, items: 3, lastSync: null } });
  assert.equal(row(d, 'feeds').state, 'No feeds set up');
  assert.match(row(d, 'feeds').detail!, /3 imported posts still on the site/);
});

test('news older than six months is a suggestion, not a problem, with a way to add one', () => {
  assert.equal(row(base(), 'news').tone, 'ok');
  assert.equal(row(base(), 'news').action, undefined);
  const d = base({ news: { count: 3, latest: '2026-03-01' } });
  assert.equal(row(d, 'news').tone, 'nudge');
  assert.equal(row(d, 'news').at, '2026-03-01');
  assert.deepEqual(row(d, 'news').action, {
    kind: 'screen',
    label: 'New news item',
    path: 'content/announcements?new',
  });
  assert.equal(row(base({ news: { count: 0, latest: null } }), 'news').tone, 'off');
});

test('people: stale profiles counted when edit times are known, said honestly when not', () => {
  assert.equal(row(base(), 'people').detail, 'Edit dates aren’t tracked in this mode');
  const d = base({
    people: { count: 3, edited: ['2026-10-01T00:00:00Z', '2025-01-01T00:00:00Z', '2024-06-01T00:00:00Z'] },
  });
  assert.equal(row(d, 'people').state, '3 profiles');
  assert.equal(row(d, 'people').detail, '2 not edited in over a year');
  assert.equal(row(d, 'people').tone, 'ok');
});

test('postgres adds the backup row; a skipped job reads as not set up, not as a failure', () => {
  const d = base({
    mode: 'postgres',
    runs: { papers: { ok: true, at: '2026-10-18T06:00:00Z', detail: 'skipped: no SERPAPI_KEY' } },
  });
  assert.equal(row(d, 'papers').tone, 'off');
  assert.equal(row(d, 'backup').state, 'No backup yet');
});

test('the job search row shows only when the daily career step reported (owner, Postgres); it reads no detail', () => {
  assert.equal(row(base({ mode: 'postgres' }), 'career'), undefined);
  const at = '2026-10-18T03:00:00Z';
  const done = base({ mode: 'postgres', runs: { career: { ok: true, at, detail: 'done' } } });
  assert.equal(row(done, 'career').tone, 'ok');
  assert.equal(row(done, 'career').label, 'Job search');
  assert.equal(row(done, 'career').detail, undefined);
  const failed = base({ mode: 'postgres', runs: { career: { ok: false, at, detail: 'failed' } } });
  assert.equal(row(failed, 'career').tone, 'attention');
  assert.equal(row(failed, 'career').state, 'Job search failed to start');
});

test('the owner’s job search row counts what waits for approval and links to it', () => {
  const at = '2026-10-18T03:00:00Z';
  const none = row(base({ mode: 'postgres', career: { ready: 0 } }), 'career');
  assert.equal(none.state, 'Nothing waiting');
  assert.equal(none.action, undefined);
  const three = row(base({ mode: 'postgres', career: { ready: 3 }, runs: { career: { ok: true, at } } }), 'career');
  assert.equal(three.state, '3 ready for approval');
  assert.equal(three.tone, 'ok');
  assert.equal(three.at, at);
  assert.deepEqual(three.action, { kind: 'screen', label: 'Review', path: 'career?status=ready' });
  const failed = row(base({ mode: 'postgres', career: { ready: 2 }, runs: { career: { ok: false, at } } }), 'career');
  assert.equal(failed.state, 'Job search failed to start', 'a failed run still leads');
  assert.equal(failed.action?.label, 'Review');
});

test('a night that stopped early leads the owner’s job search row, ahead of the ready count', () => {
  const at = '2026-10-18T03:00:00Z';
  const stopped = row(
    base({
      mode: 'postgres',
      career: { ready: 2, stopped: 'Your Claude subscription is out of quota\u202e' },
      runs: { career: { ok: true, at } },
    }),
    'career',
  );
  assert.equal(stopped.state, 'Stopped early: Your Claude subscription is out of quota');
  assert.equal(stopped.tone, 'attention');
  assert.equal(stopped.detail, '2 ready for approval');
  assert.deepEqual(stopped.action, { kind: 'screen', label: 'Review', path: 'career?status=ready' });
  const alone = row(base({ mode: 'postgres', career: { ready: 0, stopped: 'quota' } }), 'career');
  assert.equal(alone.detail, undefined);
  assert.deepEqual(alone.action, { kind: 'screen', label: 'Open', path: 'career' });
  const failed = row(
    base({ mode: 'postgres', career: { ready: 0, stopped: 'quota' }, runs: { career: { ok: false, at } } }),
    'career',
  );
  assert.equal(failed.state, 'Job search failed to start', 'a run that never started still leads');
});

test('the reading row shows today’s count to the owner', () => {
  const at = '2026-10-18T03:00:00Z';
  const some = row(base({ mode: 'postgres', reading: { today: 13 }, runs: { reading: { ok: true, at } } }), 'reading');
  assert.equal(some.label, 'Reading');
  assert.equal(some.state, '13 papers today');
  assert.equal(some.tone, 'ok');
  assert.equal(some.at, at);
  assert.deepEqual(some.action, { kind: 'screen', label: 'Open', path: 'reading' });
  assert.equal(row(base({ mode: 'postgres', reading: { today: 0 } }), 'reading').state, 'No papers today');
  const stopped = row(base({ mode: 'postgres', reading: { today: 4, stopped: 'Out of credit‮' } }), 'reading');
  assert.equal(stopped.state, 'Ranking stopped: Out of credit');
  assert.equal(stopped.tone, 'attention');
  const failed = row(
    base({ mode: 'postgres', reading: { today: 4, stopped: 'x' }, runs: { reading: { ok: false, at } } }),
    'reading',
  );
  assert.equal(failed.state, 'Reading digest failed to start', 'a run that never started leads');
  assert.equal(failed.tone, 'attention');
});

test('a non-owner sees no reading row', () => {
  // The dashboard sends `reading`, and the daily step's run, to the owner only.
  assert.equal(row(base({ mode: 'postgres' }), 'reading'), undefined);
  assert.equal(row(base({ mode: 'git', reading: { today: 2 } }), 'reading'), undefined, 'Postgres mode only');
});

test('scheduled posts with no release run: fine in git mode, unknown only where the job runner should have run it', () => {
  const posts = [post('soon', { date: '2026-10-20' })];
  const git = base({ posts });
  assert.equal(row(git, 'scheduled').tone, 'ok');
  assert.equal(row(git, 'scheduled').state, '1 scheduled');
  assert.match(row(git, 'scheduled').detail!, /^Next goes live /);
  const ran = base({ posts, runs: { scheduled: { ok: true, at: '2026-10-18T05:00:00Z' } } });
  assert.equal(row(ran, 'scheduled').at, null, 'the release job’s time is not shown as the row’s time');
  assert.equal(verdict(git).text, 'Everything is up to date');
  const pg = base({ mode: 'postgres', posts, runs: { backup: { ok: true, at: '2026-10-18T06:00:00Z' } } });
  assert.equal(row(pg, 'scheduled').tone, 'unknown');
  assert.match(row(pg, 'scheduled').detail!, /release job not run yet$/);
  assert.equal(row(pg, 'scheduled').action, undefined, 'Run daily jobs is the one control for the release job');
});

test('next up: scheduled soonest first, then post and news drafts newest first; published excluded', () => {
  const items = nextUp(
    [
      post('old-draft', { draft: true, date: '2026-01-01' }),
      post('live', { date: '2026-10-01' }),
      post('later', { date: '2026-12-01' }),
      post('new-draft', { draft: true, date: '2026-09-01', author: 'Ana Ruiz' }),
      post('sooner', { date: '2026-11-01' }),
    ],
    [
      { slug: null, data: { title: 'Grant news', date: '2026-10-10' } },
      { slug: 'award', data: { title: 'Award', date: '2026-05-01' } },
    ],
    NOW,
  );
  assert.deepEqual(
    items.map((i) => `${i.title}:${i.status}`),
    [
      'sooner:Scheduled',
      'later:Scheduled',
      'Grant news:News draft',
      'new-draft:Draft',
      'Award:News draft',
      'old-draft:Draft',
    ],
  );
  assert.equal(items[2].path, 'content/announcements?new');
  assert.equal(items[4].path, 'content/announcements?slug=award');
  assert.equal(items[3].author, 'Ana Ruiz');
  assert.equal(items[0].author, undefined);
});
