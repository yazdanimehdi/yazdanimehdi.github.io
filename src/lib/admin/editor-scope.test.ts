import test from 'node:test';
import assert from 'node:assert/strict';
import { inEditorScope } from './editor-scope';

const expect = (allowed: boolean, paths: string[]) => {
  for (const path of paths) assert.equal(inEditorScope(path), allowed, JSON.stringify(path));
};

test('site code and content are in scope', () => {
  expect(true, [
    'src/components/Header.astro',
    'src/components/Gallery.vue',
    'src/components/format.ts',
    'src/layouts/Base.astro',
    'src/layouts/helpers.ts',
    'src/styles/global.css',
    'src/themes/editorial/editorial.css',
    'src/assets/logo.svg',
    'public/images/me.jpg',
    'public/robots.txt',
    'public/vendor/lib.min.js',
    'src/data/cv.json',
    'config/site.yml',
  ]);
});

test('pages: only .astro, .md and .mdx, and nothing named api', () => {
  expect(true, [
    'src/pages/index.astro',
    'src/pages/blog/[slug].astro',
    'src/pages/about.md',
    'src/pages/notes.mdx',
    'src/pages/apiary.astro',
  ]);
  expect(false, [
    'src/pages/x.ts',
    'src/pages/feed.xml.ts',
    'src/pages/robots.txt.ts',
    'src/pages/rss.xml.js',
    'src/pages/[...slug].tsx',
    'src/pages/a.jsx',
    'src/pages/a.mjs',
    'src/pages/a.cjs',
    'src/pages/a.mts',
    'src/pages/a.cts',
    'src/pages/api.ts',
    'src/pages/api.astro',
    'src/pages/foo/api.json.ts',
    'src/pages/api/contact.ts',
    'src/pages/api/index.astro',
    'src/pages/en/api/feed.astro',
  ]);
});

test('content: only Markdown and data files, never the collection config', () => {
  expect(true, [
    'src/content/posts/hello.md',
    'src/content/posts/hello.mdx',
    'src/content/people/jane.json',
    'src/content/talks/t.yml',
    'src/content/talks/t.yaml',
  ]);
  expect(false, [
    'src/content/config.ts',
    'src/content/config.yml',
    'src/content/config.mjs',
    'src/content.config.ts',
    'src/content/posts/loader.ts',
    'src/content/posts/x.astro',
  ]);
});

test('elsewhere: no server-only modules and nothing named like an endpoint or middleware', () => {
  expect(false, [
    'src/components/x.mjs',
    'src/components/x.cjs',
    'src/layouts/x.mts',
    'src/styles/x.cts',
    'src/components/feed.xml.ts',
    'src/assets/data.json.js',
    'src/components/middleware.ts',
    'src/layouts/middleware/index.ts',
    'public/middleware.js',
    'public/worker.mjs',
  ]);
});

test('admin, server code, dependencies, secrets and odd paths are refused', () => {
  expect(false, [
    'src/admin/x.ts',
    'src/admin/routes/api/editor/session.ts',
    'src/lib/admin/secrets.ts',
    'src/lib/db.ts',
    'src/lib/mode.ts',
    'src/lib/utils.ts',
    'src/middleware.ts',
    'src/middleware/index.ts',
    'src/integrations/admin.ts',
    'src/data/jobs.json',
    'src/data/scholar.json',
    'src/data/nested/x.json',
    'config/ai.yml',
    'config/nested/site.yml',
    'migrations/001.sql',
    'scripts/sync.ts',
    '.github/workflows/ci.yml',
    'package.json',
    'pnpm-lock.yaml',
    'astro.config.mjs',
    'vercel.json',
    'vercel.ts',
    'netlify.toml',
    '.env',
    '.env.local',
    'public/.well-known/security.txt',
    'src/components/.hidden.astro',
    'src/components/../admin/x.ts',
    'src/components/./x.astro',
    'src/components//x.astro',
    '/src/components/x.astro',
    'src/components/x\nsrc/admin/y.ts',
    'src\\admin\\x.ts',
    `src/components/${'a'.repeat(300)}.astro`,
    'README.md',
    'tsconfig.json',
    '',
  ]);
});
