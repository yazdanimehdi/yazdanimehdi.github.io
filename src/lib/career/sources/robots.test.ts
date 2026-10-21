import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { setLookupForTests, SourceError } from './http';
import { clearRobotsCache, fetchAllowed, hasUndecodableRule, isRobotsBody, robotsAllows } from './robots';

const at = (path: string) => `https://x.example${path}`;
const allows = (body: string, agent: string, path: string) => robotsAllows(body, at(path), agent);

// Cases ported from ai-job-search tests/test_robots_check.py (MIT).
const BARCLAYS = 'User-agent: *\n\n\nAllow: /\n\nDisallow: /cs/\n\nSitemap: https://x/sitemap.xml\n';
const JOBUP = 'User-agent: *\nDisallow: /api/\n';

test('Disallow: / blocks', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n', at('/jobs')), false);
});

test('Allow: /careers beats Disallow: /', () => {
  const body = 'User-agent: *\nDisallow: /\nAllow: /careers\n';
  assert.equal(robotsAllows(body, at('/careers/123')), true);
  assert.equal(robotsAllows(body, at('/other')), false);
});

test('Disallow: /*.pdf$ blocks /a.pdf but not /a.pdf?x', () => {
  const body = 'User-agent: *\nDisallow: /*.pdf$\n';
  assert.equal(robotsAllows(body, at('/a.pdf')), false);
  assert.equal(robotsAllows(body, at('/a.pdf?x')), true);
  assert.equal(robotsAllows(body, at('/files/cv.pdf.html')), true);
});

test('a specific agent group beats *', () => {
  const body = 'User-agent: ScholarOS\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  assert.equal(robotsAllows(body, at('/a')), false);
  assert.equal(robotsAllows(body, at('/a'), 'OtherBot'), true);
  assert.equal(robotsAllows('User-agent: ScholarOS\nAllow: /\n\nUser-agent: *\nDisallow: /\n', at('/a')), true);
});

test('blank lines inside a record do not end it', () => {
  assert.equal(allows(BARCLAYS, '*', '/cs/'), false);
  assert.equal(allows(BARCLAYS, '*', '/careers/'), true);
});

test('the longest match wins over rule order', () => {
  assert.equal(allows('User-agent: *\nAllow: /\nDisallow: /cs/\n', '*', '/cs/deep/page'), false);
});

test('an equal-length tie goes to Disallow, in either order', () => {
  assert.equal(allows('User-agent: *\nDisallow: /a\nAllow: /a\n', '*', '/a'), false);
  assert.equal(allows('User-agent: *\nAllow: /a\nDisallow: /a\n', '*', '/a'), false);
});

test('a blocked API path leaves its sibling allowed', () => {
  assert.equal(allows(JOBUP, '*', '/api/v1/public/search'), false);
  assert.equal(allows(JOBUP, '*', '/en/jobs/'), true);
});

test('$ mid-pattern is literal', () => {
  const body = 'User-agent: *\nDisallow: /tag/$var\n';
  assert.equal(allows(body, '*', '/tag/$var'), false);
  assert.equal(allows(body, '*', '/tag/$var/sub'), false);
});

test('a percent-encoded query matches its rule', () => {
  const body = 'User-agent: *\nDisallow: /search?q=machine%20learning\n';
  assert.equal(robotsAllows(body, 'https://example.com/search?q=machine%20learning'), false);
});

test('an empty Disallow, an empty file, and a comment-only file allow everything', () => {
  assert.equal(allows('User-agent: *\nDisallow:\n', '*', '/anything'), true);
  assert.equal(allows('', '*', '/x'), true);
  assert.equal(allows('# just a comment\n', '*', '/x'), true);
});

test('comments are stripped', () => {
  assert.equal(allows('User-agent: *\nDisallow: /x  # nope\n', '*', '/x'), false);
});

test('an empty group for the agent falls back to *', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: ScholarOS\n', at('/a')), false);
});

test('a run with an invalid UTF-8 byte still decodes its valid bytes', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /職\n', at('/%E8%81%B7%FF')), false);
});

test('agent match is case-insensitive; several agents share one ruleset; absent agent falls back to *', () => {
  assert.equal(allows('User-agent: CLAUDE-USER\nDisallow: /x\n', 'claude-user', '/x'), false);
  const shared = 'User-agent: A\nUser-agent: Claude-User\nDisallow: /z\n';
  assert.equal(allows(shared, 'Claude-User', '/z'), false);
  assert.equal(allows(shared, 'A', '/z'), false);
  assert.equal(allows(JOBUP, 'Claude-User', '/api/v1'), false);
});

test('percent-encoded rules match the decoded path and do not overmatch', () => {
  assert.equal(allows('User-agent: *\nDisallow: /foo%20bar\n', '*', '/foo bar'), false);
  assert.equal(allows('User-agent: *\nDisallow: /foo%20bar\n', '*', '/foobar'), true);
});

test('a leading byte-order mark does not hide the first group', () => {
  const body = '\ufeffUser-agent: *\nDisallow: /\n';
  assert.equal(allows(body, '*', '/x'), false);
  assert.equal(allows(body, 'Claude-User', '/x'), false);
});

test('valid UTF-8 non-ASCII rules are obeyed', () => {
  const body = 'User-agent: *\nDisallow: /職涯貼士/\nDisallow: /şirket/\n';
  assert.equal(allows(body, '*', '/職涯貼士/x'), false);
  assert.equal(allows(body, '*', '/şirket/x'), false);
  assert.equal(allows(body, '*', '/cmp/x/reviews'), true);
});

test('isRobotsBody tells a policy from an error page', () => {
  assert.equal(isRobotsBody('<html><body>404 Not Found</body></html>'), false);
  assert.equal(isRobotsBody('{"error":"not found"}'), false);
  assert.equal(isRobotsBody(''), true);
  assert.equal(isRobotsBody('\n\n   \n'), true);
  assert.equal(isRobotsBody(BARCLAYS), true);
  assert.equal(isRobotsBody(JOBUP), true);
  assert.equal(isRobotsBody('Sitemap: https://x.example/sitemap.xml\n'), true);
  assert.equal(isRobotsBody('\ufeffSitemap: https://x.example/sitemap.xml\n'), true);
  assert.equal(isRobotsBody('\ufeff'), true);
});

test('hasUndecodableRule flags U+FFFD in rule lines only', () => {
  for (const body of [
    'User-agent: Bot\ufffd\n',
    'Allow: /\ufffd/\n',
    'Disallow: /\ufffd/\n',
    '\ufeffUser-agent: *\ufffd\nDisallow: /\n',
    'User-agent: *\n\ufffdDisallow: /jobs\n',
  ])
    assert.equal(hasUndecodableRule(body), true, body);
  const harmless =
    '# \ufffdirket\nUser-agent: *\nDisallow: /api/  # \ufffdzel\nSitemap: https://x/\ufffd.xml\nA\ufffd: x\n';
  assert.equal(hasUndecodableRule(harmless), false);
  assert.equal(hasUndecodableRule('User-agent: *\nDisallow: /職涯貼士/\n'), false);
});

// fetchAllowed: robots.txt fetched once per host per run, and only a 404 means "no policy".

/** Serves `routes[url]` as [status, body]; records each URL. Anything else 404s. */
function serve(routes: Record<string, [number, string] | Error>) {
  const urls: string[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    const r = routes[url];
    if (r instanceof Error) throw r;
    return r ? new Response(r[1], { status: r[0] }) : new Response('missing', { status: 404 });
  });
  return urls;
}

test.beforeEach(() => {
  clearRobotsCache();
  setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);
});
test.afterEach(() => {
  mock.restoreAll();
  setLookupForTests(null);
});

test('fetchAllowed reads robots.txt once per host, then the page', async () => {
  const urls = serve({
    'https://acme.example/robots.txt': [200, 'User-agent: *\nDisallow: /private\n'],
    'https://acme.example/careers': [200, 'page one'],
    'https://acme.example/careers/2': [200, 'page two'],
  });
  assert.equal(await fetchAllowed('https://acme.example/careers'), 'page one');
  assert.equal(await fetchAllowed('https://acme.example/careers/2'), 'page two');
  assert.deepEqual(urls, [
    'https://acme.example/robots.txt',
    'https://acme.example/careers',
    'https://acme.example/careers/2',
  ]);
});

test('a disallowed URL throws without fetching the page', async () => {
  const urls = serve({ 'https://acme.example/robots.txt': [200, 'User-agent: *\nDisallow: /\n'] });
  await assert.rejects(
    fetchAllowed('https://acme.example/careers'),
    new SourceError('robots.txt disallows https://acme.example/careers'),
  );
  assert.deepEqual(urls, ['https://acme.example/robots.txt']);
});

test('a 404 robots.txt allows everything', async () => {
  serve({ 'https://acme.example/careers': [200, 'ok'] });
  assert.equal(await fetchAllowed('https://acme.example/careers'), 'ok');
});

test('robots.txt fails closed: 403, 500, a network error, a soft 200, an undecodable rule', async () => {
  for (const answer of [
    [403, 'User-agent: *\nAllow: /\n'],
    [500, 'boom'],
    new TypeError('fetch failed'),
    [200, '<html>404</html>'],
    [200, 'User-agent: *\nDisallow: /\ufffdirket/\n'],
  ] as const) {
    clearRobotsCache();
    mock.restoreAll();
    const urls = serve({
      'https://acme.example/robots.txt': answer as [number, string] | Error,
      'https://acme.example/careers': [200, 'ok'],
    });
    await assert.rejects(
      fetchAllowed('https://acme.example/careers'),
      new SourceError('robots.txt unconfirmed for acme.example'),
      String(answer),
    );
    assert.deepEqual(urls, ['https://acme.example/robots.txt'], 'the page is never fetched');
  }
});
