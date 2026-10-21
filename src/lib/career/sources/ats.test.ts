import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ATS_MAX_BYTES, atsPostings, detectAts, watched } from './ats';
import { getJson, getText, setLookupForTests, SourceError } from './http';
import { SOURCES, type SourceContext } from './index';
import { parsePrefs } from '../settings';

const fixture = (name: string) => JSON.parse(fs.readFileSync(`tests/fixtures/career/${name}.json`, 'utf8'));

/** Serves `routes[url]` as JSON, records each requested URL, and 404s anything else. */
function serve(routes: Record<string, unknown>) {
  const urls: string[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    return url in routes ? Response.json(routes[url]) : new Response('missing', { status: 404 });
  });
  return urls;
}

// No test resolves real DNS; every name is public unless a test says otherwise.
const publicLookup = async () => [{ address: '93.184.215.14', family: 4 }];
setLookupForTests(publicLookup);

test.afterEach(() => {
  mock.restoreAll();
  setLookupForTests(publicLookup);
});

test('detectAts recognizes each board URL form', () => {
  const cases: [string, ReturnType<typeof detectAts>][] = [
    ['https://boards.greenhouse.io/airbnb', { kind: 'greenhouse', token: 'airbnb' }],
    ['https://job-boards.greenhouse.io/airbnb/jobs/7789554', { kind: 'greenhouse', token: 'airbnb' }],
    ['https://jobs.lever.co/palantir/6ed76ce8', { kind: 'lever', token: 'palantir' }],
    ['https://jobs.ashbyhq.com/openai', { kind: 'ashby', token: 'openai' }],
    ['https://apply.workable.com/huggingface/', { kind: 'workable', token: 'huggingface' }],
    ['https://jobs.smartrecruiters.com/Ubisoft2', { kind: 'smartrecruiters', token: 'Ubisoft2' }],
    ['https://careers.smartrecruiters.com/Ubisoft2/jobs', { kind: 'smartrecruiters', token: 'Ubisoft2' }],
    ['https://acme.com/careers', null],
    ['https://constructor/x', null],
    ['https://boards.greenhouse.io/', null],
    ['https://apply.workable.com/j/81B46579FE', null],
  ];
  for (const [url, want] of cases) assert.deepEqual(detectAts(url), want, url);
});

test('greenhouse maps its fixture', async () => {
  serve({ 'https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=true': fixture('greenhouse') });
  const [p] = await atsPostings('greenhouse', 'airbnb');
  assert.equal(p.company, 'Airbnb');
  assert.equal(p.title, 'Associate Legal Counsel, Japan');
  assert.equal(p.url, 'https://careers.airbnb.com/positions/7789554?gh_jid=7789554');
  assert.equal(p.externalId, '7789554');
  assert.equal(p.format, 'html');
  assert.match(p.description, /^<div class="content-intro"><p>/, 'content is unescaped once');
  assert.deepEqual(p.ats, { kind: 'greenhouse', board: 'airbnb', id: '7789554' });
});

test('lever maps its fixture', async () => {
  serve({ 'https://api.lever.co/v0/postings/palantir?mode=json': fixture('lever') });
  const [p] = await atsPostings('lever', 'palantir');
  assert.equal(p.company, 'palantir');
  assert.equal(p.title, 'Administrative Business Partner');
  assert.equal(p.url, 'https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd');
  assert.equal(p.externalId, '6ed76ce8-4156-4b60-b120-403538bd66cd');
  assert.match(p.description, /The Role/, 'the lists are part of the description');
});

test('ashby maps its fixture', async () => {
  serve({ 'https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true': fixture('ashby') });
  const [p] = await atsPostings('ashby', 'openai');
  assert.equal(p.company, 'openai');
  assert.equal(p.title, 'Technical Program Manager, Compute Infrastructure');
  assert.equal(p.url, 'https://jobs.ashbyhq.com/openai/8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3');
  assert.equal(p.externalId, '8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3');
  assert.ok(p.description.length > 0);
  assert.deepEqual(p.salary, { min: 257000, max: 335000, currency: 'USD', period: 'year' });
});

test('workable maps its fixture', async () => {
  serve({ 'https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true': fixture('workable') });
  const [p] = await atsPostings('workable', 'huggingface');
  assert.equal(p.company, 'Hugging Face');
  assert.equal(p.title, 'Open-Source Machine Learning Engineer - EMEA Remote');
  assert.equal(p.url, 'https://apply.workable.com/j/81B46579FE');
  assert.equal(p.externalId, '81B46579FE');
  assert.ok(p.description.length > 0);
  assert.equal(p.remote, true);
});

test('smartrecruiters maps its fixture', async () => {
  const fx = fixture('smartrecruiters');
  const api = 'https://api.smartrecruiters.com/v1/companies/Ubisoft2/postings';
  serve({ [api]: fx.postings, [`${api}/744000156764558`]: fx.detail });
  const [p] = await atsPostings('smartrecruiters', 'Ubisoft2');
  assert.equal(p.company, 'Ubisoft');
  assert.equal(p.title, 'QC Manager - TSD');
  assert.equal(p.url, 'https://jobs.smartrecruiters.com/Ubisoft2/744000156764558');
  assert.equal(p.externalId, '744000156764558');
  assert.equal(p.description, '', 'the list has no description; detail fetches it');
  const ctx = { prefs: parsePrefs({}), siteUrl: 'https://example.com' } as SourceContext;
  const d = await watched.detail!(p, ctx);
  assert.equal(d.format, 'html');
  assert.match(d.description, /<h2>Job Description<\/h2><p><strong>Job Purpose/);
});

test('watched reads recognized boards only and is registered', async () => {
  const urls = serve({ 'https://api.lever.co/v0/postings/palantir?mode=json': fixture('lever') });
  const prefs = parsePrefs({ watched: ['https://jobs.lever.co/palantir', 'https://acme.com/careers'] });
  const found = await SOURCES.watched.search({ prefs, siteUrl: 'https://example.com' } as SourceContext);
  assert.equal(found.length, 2);
  assert.deepEqual(urls, ['https://api.lever.co/v0/postings/palantir?mode=json']);
  assert.equal(SOURCES.watched.defaultOn, true);
});

test('a board answering 500 or HTML throws SourceError', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
  await assert.rejects(atsPostings('lever', 'palantir'), SourceError);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response('<html>hi</html>', { status: 200 }));
  await assert.rejects(atsPostings('greenhouse', 'airbnb'), SourceError);
});

test('getText refuses non-http and private hosts', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok'));
  for (const url of [
    'file:///etc/passwd',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://2130706433/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::ffff:127.0.0.1]/',
    'http://intranet.localhost/',
    'http://localhost./',
    'http://x.localhost./',
    'http://[::127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
  ]) {
    await assert.rejects(getText(url), SourceError, url);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('a redirect to a private host is refused', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.redirect('http://10.0.0.5/admin', 302));
  await assert.rejects(getText('https://example.com/jobs'), SourceError);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('getText follows public redirects, sends the User-Agent, and caps hops', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    seen.push({ url: input, init });
    return input.endsWith('/final')
      ? new Response('done')
      : new Response(null, { status: 301, headers: { location: '/final' } });
  });
  assert.equal(await getText('https://example.com/start', { siteUrl: 'https://me.dev' }), 'done');
  assert.deepEqual(
    seen.map((s) => s.url),
    ['https://example.com/start', 'https://example.com/final'],
  );
  assert.equal(
    (seen[0].init.headers as Record<string, string>)['User-Agent'],
    'ScholarOS job search (+https://me.dev)',
  );
  assert.equal(seen[0].init.redirect, 'manual');
  assert.ok(seen[0].init.signal);

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: '/again' } }));
  await assert.rejects(getText('https://example.com/loop'), SourceError);
});

test('a body past 5 MB throws SourceError', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(5 * 1024 * 1024 + 1)));
  await assert.rejects(getText('https://example.com/big'), SourceError);
});

test('maxBytes raises or lowers the body cap per call', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(100)));
  await assert.rejects(getText('https://example.com/a', { maxBytes: 99 }), SourceError);
  assert.equal((await getText('https://example.com/a', { maxBytes: 100 })).length, 100);
});

test('ATS board calls use the raised cap', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(5 * 1024 * 1024 + 1)));
  await assert.rejects(
    atsPostings('lever', 'palantir'),
    /did not answer JSON/,
    'past 5 MB is read, then fails as JSON',
  );
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(ATS_MAX_BYTES, 25 * 1024 * 1024);
});

test('a cross-origin redirect drops caller headers', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    seen.push({ url: input, headers: init.headers as Record<string, string> });
    if (input === 'https://a.example/1') return new Response(null, { status: 302, headers: { location: '/2' } });
    if (input === 'https://a.example/2')
      return new Response(null, { status: 302, headers: { location: 'https://b.example/3' } });
    return Response.json({ ok: true });
  });
  await getJson('https://a.example/1', { headers: { 'Authorization-Key': 'secret' } });
  assert.deepEqual(
    seen.map((s) => s.url),
    ['https://a.example/1', 'https://a.example/2', 'https://b.example/3'],
  );
  assert.equal(seen[1].headers['Authorization-Key'], 'secret', 'a same-origin redirect keeps it');
  assert.deepEqual(Object.keys(seen[2].headers).sort(), ['Accept', 'User-Agent']);
});

test('a public name resolving to a private address is refused before fetching', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok'));
  for (const addresses of [
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '93.184.215.14', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ],
    [{ address: '::1', family: 6 }],
  ]) {
    setLookupForTests(async () => addresses);
    await assert.rejects(getText('https://127.0.0.1.nip.io/'), /private/);
  }
  setLookupForTests(async () => {
    throw new Error('getaddrinfo ENOTFOUND nowhere.example');
  });
  await assert.rejects(getText('https://nowhere.example/'), SourceError);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('each redirect hop is resolved and checked', async () => {
  const looked: string[] = [];
  setLookupForTests(async (host) => {
    looked.push(host);
    return [{ address: host === 'inside.example' ? '192.168.1.1' : '93.184.215.14', family: 4 }];
  });
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.redirect('https://inside.example/x', 302));
  await assert.rejects(getText('https://outside.example/a'), /private/);
  assert.deepEqual(looked, ['outside.example', 'inside.example']);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('a non-2xx SourceError carries the status', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 403 }));
  await assert.rejects(getText('https://x.example/a'), (e) => e instanceof SourceError && e.status === 403);
});

test('http.ts error messages never quote the query string', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('<html>not json</html>'));
  await assert.rejects(getJson('https://x.example/a?api_key=SECRET'), (e: Error) => {
    assert.ok(e instanceof SourceError);
    assert.match(e.message, /x\.example\/a/);
    assert.doesNotMatch(e.message, /SECRET/);
    return true;
  });
  mock.restoreAll();
  mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 302, headers: { location: '/again?api_key=SECRET' } }),
  );
  await assert.rejects(getText('https://x.example/loop?api_key=SECRET'), (e: Error) => !/SECRET/.test(e.message));
});
