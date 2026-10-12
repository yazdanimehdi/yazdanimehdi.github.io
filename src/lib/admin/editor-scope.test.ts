import test from 'node:test';
import assert from 'node:assert/strict';
import { inEditorScope } from './editor-scope';

test('site code and content are in scope', () => {
  for (const path of [
    'src/components/Header.astro',
    'src/layouts/Base.astro',
    'src/pages/index.astro',
    'src/pages/blog/[slug].astro',
    'src/pages/apiary.astro',
    'src/styles/global.css',
    'src/themes/editorial/editorial.css',
    'src/assets/logo.svg',
    'src/content/posts/hello.md',
    'src/data/cv.json',
    'public/images/me.jpg',
    'public/robots.txt',
    'config/site.yml',
  ]) {
    assert.equal(inEditorScope(path), true, path);
  }
});

test('admin, server code, dependencies, secrets and odd paths are refused', () => {
  for (const path of [
    'src/admin/x.ts',
    'src/admin/routes/api/editor/session.ts',
    'src/lib/admin/secrets.ts',
    'src/lib/db.ts',
    'src/lib/mode.ts',
    'src/lib/utils.ts',
    'src/middleware.ts',
    'src/middleware/index.ts',
    'src/integrations/admin.ts',
    'src/pages/api/contact.ts',
    'src/pages/en/api/feed.ts',
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
  ]) {
    assert.equal(inEditorScope(path), false, JSON.stringify(path));
  }
});
