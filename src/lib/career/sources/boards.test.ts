import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SourceError } from './http';
import { SOURCES, type SourceContext } from './index';
import { SUGGESTED_FEEDS } from './rss';
import { parsePrefs } from '../settings';
import type { SecretName } from '../../admin/secrets';

const file = (name: string) => fs.readFileSync(`tests/fixtures/career/${name}`, 'utf8');
const fixture = (name: string) => JSON.parse(file(`${name}.json`));

/** Serves the first route whose key prefixes the requested URL, records every URL and header set, and 404s the rest. */
function serve(routes: Record<string, unknown>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const hit = Object.keys(routes).find((k) => url.startsWith(k));
    if (!hit) return new Response('missing', { status: 404 });
    const body = routes[hit];
    return typeof body === 'string' ? new Response(body) : Response.json(body);
  });
  return calls;
}

function ctx(prefs: Record<string, unknown> = {}, keys: Partial<Record<SecretName, string>> = {}): SourceContext {
  return {
    prefs: parsePrefs({ roles: ['data scientist'], keywords: ['python'], locations: ['Boston'], ...prefs }),
    secret: async (n) => keys[n],
    siteUrl: 'https://site.test',
    ai: async () => '',
  };
}

test.afterEach(() => mock.restoreAll());

test('remotive maps its fixture', async () => {
  const calls = serve({ 'https://remotive.com/api/remote-jobs?search=': fixture('remotive') });
  const [p, q] = await SOURCES.remotive.search(ctx());
  assert.match(calls[0].url, /search=data%20scientist%20python|search=data\+scientist\+python/);
  assert.equal(p.source, 'remotive');
  assert.equal(p.externalId, '2091158');
  assert.equal(p.company, 'Askable');
  assert.equal(p.title, 'Software Engineer, AI Coding Tasks');
  assert.equal(
    p.url,
    'https://remotive.com/remote-jobs/software-development/software-engineer-ai-coding-tasks-2091158',
  );
  assert.equal(p.remote, true);
  assert.equal(p.location, 'Worldwide');
  assert.equal(p.format, 'html');
  assert.equal(p.postedAt, '2026-10-17T16:04:29');
  assert.equal(q.location, 'USA, Canada, USA timezones');
});

test('remoteok maps its fixture, skipping the legal notice and linking back', async () => {
  serve({ 'https://remoteok.com/api': fixture('remoteok') });
  const ps = await SOURCES.remoteok.search(ctx({ roles: [], keywords: [] }));
  assert.equal(ps.length, 2, 'the legal notice is not a posting');
  const [p] = ps;
  assert.equal(p.source, 'remoteok');
  assert.equal(p.externalId, '1137548');
  assert.equal(p.company, 'Pavago');
  assert.equal(p.title, 'Risk Analyst');
  assert.match(p.url, /^https:\/\/remoteok\.com\/remote-jobs\//i, 'the link back to Remote OK');
  assert.equal(p.remote, true);
  assert.equal(p.format, 'html');
  assert.equal(p.postedAt, '2026-10-20T08:00:05+00:00');
});

test('arbeitnow maps its fixture', async () => {
  serve({ 'https://www.arbeitnow.com/api/job-board-api': fixture('arbeitnow') });
  const [p] = await SOURCES.arbeitnow.search(ctx({ roles: [], keywords: [] }));
  assert.equal(p.source, 'arbeitnow');
  assert.equal(p.externalId, 'junior-hr-business-partner-in-teil-oder-vollzeit-cologne-189594');
  assert.equal(p.company, 'allaboutHRLaw GmbH');
  assert.equal(p.location, 'Cologne');
  assert.equal(p.remote, false);
  assert.equal(p.format, 'html');
  assert.equal(p.postedAt, new Date(1792584061 * 1000).toISOString());
});

test('arbeitnow keeps only postings that match the query', async () => {
  serve({ 'https://www.arbeitnow.com/api/job-board-api': fixture('arbeitnow') });
  assert.equal((await SOURCES.arbeitnow.search(ctx({ roles: ['nonexistent-role-xyz'], keywords: [] }))).length, 0);
  assert.equal((await SOURCES.arbeitnow.search(ctx({ roles: ['HR Business Partner'], keywords: [] }))).length, 1);
});

test('adzuna maps its fixture', async () => {
  const calls = serve({ 'https://api.adzuna.com/v1/api/jobs/us/search/1': fixture('adzuna') });
  const [p, q] = await SOURCES.adzuna.search(ctx({}, { ADZUNA_APP_ID: 'the-id', ADZUNA_APP_KEY: 'the-key' }));
  assert.match(calls[0].url, /app_id=the-id&app_key=the-key/);
  assert.match(calls[0].url, /where=Boston/);
  assert.equal(p.source, 'adzuna');
  assert.equal(p.externalId, '4350987651');
  assert.equal(p.company, 'Example Labs');
  assert.equal(p.title, 'Research Software Engineer');
  assert.equal(p.location, 'Boston, Suffolk County');
  assert.equal(p.url, 'https://www.adzuna.com/land/ad/4350987651?se=abc&v=123');
  assert.equal(p.format, 'text');
  assert.equal(p.postedAt, '2026-10-19T08:15:00Z');
  assert.deepEqual(p.salary, { min: 90000, max: 120000, period: 'year' });
  assert.equal(q.salary, undefined, 'a predicted salary is not the ad’s salary');
});

test('adzuna uses the country option', async () => {
  const calls = serve({ 'https://api.adzuna.com/v1/api/jobs/gb/search/1': fixture('adzuna') });
  await SOURCES.adzuna.search(
    ctx({ sources: { adzuna: { on: true, options: { country: 'gb' } } } }, { ADZUNA_APP_ID: 'i', ADZUNA_APP_KEY: 'k' }),
  );
  assert.equal(calls.length, 1);
});

test('adzuna without keys reports skipped, not failed', () => {
  assert.deepEqual(SOURCES.adzuna.needs, ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
  assert.equal(SOURCES.adzuna.defaultOn, false);
});

test('a key never appears in an error message', async () => {
  serve({ 'https://api.adzuna.com/': '<html>not json</html>' });
  await assert.rejects(
    SOURCES.adzuna.search(ctx({}, { ADZUNA_APP_ID: 'secret-id', ADZUNA_APP_KEY: 'secret-key' })),
    (e: Error) => e instanceof SourceError && !/secret-id|secret-key/.test(e.message),
  );
});

test('usajobs maps its fixture', async () => {
  const calls = serve({ 'https://data.usajobs.gov/api/search?': fixture('usajobs') });
  const [p, q] = await SOURCES.usajobs.search(
    ctx({ sources: { usajobs: { on: true, options: { email: 'me@example.com' } } } }, { USAJOBS_API_KEY: 'k1' }),
  );
  assert.equal(calls[0].headers['Authorization-Key'], 'k1');
  assert.equal(calls[0].headers['User-Agent'], 'me@example.com');
  assert.equal(p.source, 'usajobs');
  assert.equal(p.externalId, '812345600');
  assert.equal(p.company, 'Example Bureau');
  assert.equal(p.title, 'Data Scientist');
  assert.equal(p.location, 'Washington, District of Columbia');
  assert.equal(p.url, 'https://www.usajobs.gov/job/812345600');
  assert.equal(p.applyUrl, 'https://www.usajobs.gov/job/812345600?apply=1');
  assert.equal(p.format, 'text');
  assert.match(p.description, /survey data/);
  assert.match(p.description, /Builds statistical models/);
  assert.equal(p.postedAt, '2026-10-15');
  assert.deepEqual(p.salary, { min: 103690, max: 134795, currency: 'USD', period: 'year' });
  assert.equal(q.salary?.period, 'hour');
});

test('usajobs without a contact email throws', async () => {
  serve({});
  await assert.rejects(
    SOURCES.usajobs.search(ctx({}, { USAJOBS_API_KEY: 'k1' })),
    new SourceError('USAJobs needs a contact email in its source options'),
  );
});

test('google-jobs maps its fixture and pages at most twice per query', async () => {
  const calls = serve({ 'https://serpapi.com/search.json?': fixture('google-jobs') });
  const ps = await SOURCES['google-jobs'].search(ctx({}, { SERPAPI_KEY: 'serp-key' }));
  assert.equal(calls.length, 2, 'two pages, then stop although a token is still offered');
  assert.match(calls[1].url, /next_page_token=TOKEN2/);
  assert.match(calls[0].url, /engine=google_jobs/);
  assert.equal(ps.length, 2, 'the same job on both pages is one posting');
  const [p, q] = ps;
  assert.equal(p.source, 'google-jobs');
  assert.equal(p.externalId, 'eyJqb2JfdGl0bGUiOiJSZXNlYXJjaCBTb2Z0d2FyZSBFbmdpbmVlciJ9');
  assert.equal(p.company, 'Example Labs');
  assert.equal(p.location, 'Boston, MA');
  assert.equal(p.url, 'https://www.linkedin.com/jobs/view/1234567890');
  assert.equal(p.format, 'text');
  assert.equal(q.remote, true);
});

test('rss: one malformed item is skipped, the rest kept', async () => {
  const xml = file('rss.xml').replace(
    '</channel>',
    '<item><description>no title or link</description></item></channel>',
  );
  serve({ 'https://feed.test/a': xml });
  const ps = await SOURCES.rss.search(ctx({ feeds: ['https://feed.test/a'] }));
  assert.equal(ps.length, 2);
  const [p] = ps;
  assert.equal(p.source, 'rss');
  assert.equal(p.title, 'Assistant Professor in Computational Quantum Chemistry');
  assert.equal(p.url, 'https://www.higheredjobs.com/details.cfm?JobCode=179593542');
  assert.equal(p.externalId, 'https://www.higheredjobs.com/details.cfm?JobCode=179593542');
  assert.equal(p.company, 'HigherEdJobs - Chemistry', 'the feed title stands in for a missing company');
  assert.equal(p.format, 'text');
  assert.ok(p.postedAt?.startsWith('2026-10-20'));
});

test('rss: a failing feed does not stop the others; all failing throws', async () => {
  serve({ 'https://feed.test/ok': file('rss.xml') });
  const ps = await SOURCES.rss.search(ctx({ feeds: ['https://feed.test/bad', 'https://feed.test/ok'] }));
  assert.equal(ps.length, 2);
  await assert.rejects(SOURCES.rss.search(ctx({ feeds: ['https://feed.test/bad'] })), /feed\.test\/bad/);
});

test('SUGGESTED_FEEDS are well-formed http(s) URLs', () => {
  assert.ok(SUGGESTED_FEEDS.length > 0);
  for (const f of SUGGESTED_FEEDS) assert.ok(f.label && new URL(f.url).protocol === 'https:');
});

test('google-jobs with no roles or keywords makes no request', async () => {
  const calls = serve({});
  const empty = { roles: [], keywords: [] };
  assert.deepEqual(await SOURCES['google-jobs'].search(ctx(empty, { SERPAPI_KEY: 'k' })), []);
  assert.deepEqual(await SOURCES.adzuna.search(ctx(empty, { ADZUNA_APP_ID: 'i', ADZUNA_APP_KEY: 'k' })), []);
  assert.deepEqual(await SOURCES.usajobs.search(ctx(empty, { USAJOBS_API_KEY: 'k' })), []);
  assert.equal(calls.length, 0);
});
