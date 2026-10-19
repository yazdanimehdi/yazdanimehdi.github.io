import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { editorTarget } from '../../lib/admin/editor';
import { githubConfig } from '../../lib/admin/github-store';
import { missingKey } from '../../lib/admin/secrets';
import { changedPages, diffLines, elapsed, explain, failureLine, groupFiles, stepItems } from './site';

function messageOf(call: () => unknown): string {
  try {
    call();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a throw');
}

test('each reason the server gives maps to plain language and one action, keeping the raw text', () => {
  const saved = process.env.VERCEL;
  delete process.env.VERCEL;
  const staticBuild = messageOf(() => editorTarget());
  if (saved !== undefined) process.env.VERCEL = saved;
  const cases: [string, string, string][] = [
    [staticBuild, 'The Site editor needs the admin on Vercel', 'copy'],
    [messageOf(() => githubConfig({ GITHUB_REPO: 'jane/site' })), 'Connect the site’s GitHub repository', 'copy'],
    [messageOf(() => githubConfig({ GITHUB_TOKEN: 'x' })), 'Say which repository holds the site', 'copy'],
    [
      'Vercel Sandbox: looking up the session failed: Could not get credentials from OIDC context',
      'The admin can’t sign in to Vercel Sandbox',
      'copy',
    ],
    [
      'Vercel Sandbox: looking up the session failed: fetch failed',
      'Vercel Sandbox can’t be reached right now',
      'retry',
    ],
    [missingKey('ANTHROPIC_API_KEY').message, 'Add a key for the AI provider', 'ai'],
  ];
  for (const [raw, title, action] of cases) {
    const n = explain(raw);
    assert.equal(n.title, title, raw);
    assert.equal(n.action, action, raw);
    assert.equal(n.raw, raw);
    assert.ok(!n.body.includes('_'), `no variable names in the headline: ${n.body}`);
    if (action === 'copy') assert.match(n.steps ?? '', /^Site editor setup/);
  }
  const unknown = explain('Something new went wrong');
  assert.equal(unknown.body, 'Something new went wrong', 'unknown text is shown as it is');
  assert.equal(unknown.action, 'retry');
});

test('changed files group by kind, refused first, empty groups left out', () => {
  const f = (path: string, allowed = true) => ({ path, allowed, status: 'modified' as const, binary: false });
  const groups = groupFiles([
    f('src/components/Header.astro'),
    f('src/styles/global.css'),
    f('src/themes/editorial/editorial.css'),
    f('src/pages/index.astro'),
    f('src/admin/x.ts', false),
    f('config/site.yml'),
    f('src/content/posts/a.md'),
    f('public/logo.png'),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.kind, g.files.map((x) => x.path)]),
    [
      ['refused', ['src/admin/x.ts']],
      ['pages', ['src/components/Header.astro', 'src/pages/index.astro']],
      ['styles', ['src/styles/global.css', 'src/themes/editorial/editorial.css']],
      ['content', ['config/site.yml', 'src/content/posts/a.md']],
      ['other', ['public/logo.png']],
    ],
  );
  assert.deepEqual(groupFiles([]), []);
});

test('changed files name the pages they show on; layouts, styles and shared files mean every page', () => {
  assert.deepEqual(
    changedPages([
      'src/themes/editorial/Home.astro',
      'src/pages/publications.astro',
      'src/themes/classic/Publications.astro',
      'src/pages/blog/[id].astro',
      'src/content/announcements/a.md',
      'public/logo.png',
    ]),
    {
      every: false,
      pages: [
        { label: 'Home', path: '/' },
        { label: 'Publications', path: '/publications' },
        { label: 'Blog pages', path: '/blog' },
        { label: 'News', path: '/news' },
      ],
    },
  );
  for (const p of ['src/layouts/BaseLayout.astro', 'src/themes/editorial/editorial.css', 'config/site.yml']) {
    assert.equal(changedPages([p]).every, true, p);
  }
  assert.deepEqual(changedPages(['src/data/cv.json', 'src/pages/feed.xml.ts']), { every: false, pages: [] });
});

test('each theme page component links to the section of the page that imports it', () => {
  const links = (p: string) => changedPages([p]).pages.map((x) => x.path);
  for (const file of fs.readdirSync('src/pages', { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.astro')) continue;
    const route = file.split(path.sep).join('/');
    const source = fs.readFileSync(`src/pages/${route}`, 'utf8');
    for (const [, theme, name] of source.matchAll(/from '[./]+\/themes\/([a-z]+)\/([A-Za-z]+)\.astro'/g)) {
      assert.deepEqual(links(`src/themes/${theme}/${name}.astro`), links(`src/pages/${route}`), `${route}: ${name}`);
    }
  }
});

test('a setup text’s numbered steps become list items, indented lines kept with their step', () => {
  assert.deepEqual(stepItems('Title\nOn your own computer:\n1. Run a\n2. Then b\n   It expires.\n3. Restart\nMore.'), [
    'Run a',
    'Then b It expires.',
    'Restart',
  ]);
  assert.equal(stepItems(explain('Set GITHUB_REPO to owner/name').steps ?? '').length, 3);
});

test('diff lines are tagged for colour and keep their +/- sign', () => {
  const diff = `diff --git a/x.astro b/x.astro
index 1..2 100644
--- a/x.astro
+++ b/x.astro
@@ -1 +1 @@
-old
+new
 same
`;
  assert.deepEqual(
    diffLines(diff).map((l) => l.kind),
    ['meta', 'meta', 'meta', 'meta', 'hunk', 'del', 'add', 'context'],
  );
  assert.equal(diffLines(diff)[5].text, '-old');
  assert.deepEqual(diffLines(''), []);
});

test('elapsed time reads like a stopwatch and never goes negative', () => {
  assert.equal(elapsed(-5000), '0s');
  assert.equal(elapsed(45_900), '45s');
  assert.equal(elapsed(130_000), '2m 10s');
  assert.equal(elapsed(3_900_000), '1h 5m');
});

test('a file’s diff header names its path, spaces included; quoted paths get none', () => {
  const files = diffLines(
    [
      'diff --git a/src/pages/a b.astro b/src/pages/a b.astro',
      '--- a/src/pages/a b.astro',
      '+diff --git a/x b/x',
      'diff --git "a/caf\\303\\251.md" "b/caf\\303\\251.md"',
    ].join('\n'),
  ).map((l) => l.file);
  assert.deepEqual(files, ['src/pages/a b.astro', undefined, undefined, undefined]);
});

test('a failed run’s technical details quote the last error-like line of its log', () => {
  const log =
    'Reading Home.astro\nError: astro check failed with 3 errors\n  Home.astro:41 Cannot find name\nexited 1\n';
  assert.equal(failureLine(log), 'Error: astro check failed with 3 errors');
  assert.equal(failureLine('Reading\nFailed: The API key was rejected'), 'The API key was rejected');
  assert.equal(failureLine('just one line\n\n'), 'just one line');
  assert.equal(failureLine(''), '');
  assert.equal(failureLine(`error ${'x'.repeat(300)}`).length, 200);
});

test('a failed run’s technical details prefer the line naming what went wrong over a later generic wrapper', () => {
  const log = [
    '> Running astro check',
    'Error: astro check failed: src/components/astro/Header.astro:14:5 Unexpected token',
    ' ELIFECYCLE  Command failed with exit code 1.',
    'Failed: the agent exited with code 1',
  ].join('\n');
  assert.equal(failureLine(log), 'Error: astro check failed: src/components/astro/Header.astro:14:5 Unexpected token');
  assert.equal(
    failureLine('Reading\nFailed: the agent exited with code 1'),
    'the agent exited with code 1',
    'a generic line still beats no error line',
  );
});
