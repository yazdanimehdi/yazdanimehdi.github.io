import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { CvRenderError, cvRenderRequest, renderCv, type CvRenderRequest } from './cv-render';
import { MemoryStore } from './admin/memory-store';
import { PathError } from './admin/paths';
import type { CvStyle } from './cv-styles';
import { UpstreamError } from './admin/store';

const req = {
  cv: {},
  upload: null,
  publications: [],
  author: 'A',
  style: { id: 'x' },
  themeFiles: {},
} as unknown as CvRenderRequest;
const realFetch = globalThis.fetch;
const realSecret = process.env.SESSION_SECRET;
const realUrl = process.env.CV_RENDER_URL;
const realVercel = process.env.VERCEL;
const realVercelEnv = process.env.VERCEL_ENV;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [
    ['CV_RENDER_URL', realUrl],
    ['SESSION_SECRET', realSecret],
    ['VERCEL', realVercel],
    ['VERCEL_ENV', realVercelEnv],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function stub(res: Response, seen: { url?: string; key?: string } = {}) {
  process.env.CV_RENDER_URL = 'http://render.test/';
  process.env.SESSION_SECRET = 's3cret';
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.key = (init.headers as Record<string, string>)['x-cv-render-key'];
    return res;
  }) as never;
  return seen;
}

test('renderCv posts to the binding with the key', async () => {
  const seen = stub(new Response('%PDF-1', { status: 200 }));
  const bytes = await renderCv(req);
  assert.match(seen.url!, /\/render$/);
  assert.equal(seen.key, createHmac('sha256', 's3cret').update('cv-render').digest('hex'));
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1');
});

test('renderCv without a binding: a deployed function refuses, astro dev (VERCEL=1, no VERCEL_ENV) runs the CLI', async () => {
  delete process.env.CV_RENDER_URL;
  process.env.VERCEL = '1';
  for (const env of ['production', 'preview']) {
    process.env.VERCEL_ENV = env;
    await assert.rejects(renderCv(req), (e) => e instanceof UpstreamError && /not configured/.test(e.message));
  }
  delete process.env.VERCEL_ENV;
  // The CLI refuses this empty CV (exit 2), or python3 is missing: either way it was the CLI that ran.
  await assert.rejects(renderCv(req), (e) => e instanceof Error && !/not configured/.test(e.message));
});

test('renderCv maps 422 to CvRenderError', async () => {
  stub(Response.json({ error: 'bad margin' }, { status: 422 }));
  await assert.rejects(renderCv(req), (e) => e instanceof CvRenderError && e.message === 'bad margin');
});

test('renderCv without SESSION_SECRET is an UpstreamError, not an empty-key request', async () => {
  stub(new Response('%PDF-1'));
  delete process.env.SESSION_SECRET;
  await assert.rejects(renderCv(req), /SESSION_SECRET/);
});

test('cvRenderRequest rejects a theme that is a path and reads nothing outside cv/themes', async () => {
  const store = new MemoryStore();
  const reads: string[] = [];
  const listed: string[] = [];
  const read = store.read.bind(store);
  const list = store.list.bind(store);
  store.read = async (p) => (reads.push(p), read(p));
  store.list = async (d) => (listed.push(d), list(d));
  const style = { id: 'x', name: 'X', theme: '../../config', density: 'normal', design: {} } as CvStyle;
  await assert.rejects(cvRenderRequest(store, style), PathError);
  assert.deepEqual(listed, ['src/content/publications']);
  const outside = (p: string) => p.includes('..') || !/^(config\/|src\/content\/publications|cv\/themes\/)/.test(p);
  assert.deepEqual([...reads, ...listed].filter(outside), []);
});

test("cvRenderRequest loads an enabled upload's own custom theme and validates its name", async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cv-render-'));
  const write = (p: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), text);
  };
  write('config/cv.yml', 'cv:\n  name: N\n');
  write('config/site.yml', 'author: N\n');
  write('cv/themes/mine/Preamble.j2.typ', 'x');
  const upload = (theme: string, enabled = true) =>
    write('config/cv-upload.yml', stringify({ enabled, content: `cv:\n  name: U\ndesign:\n  theme: '${theme}'\n` }));
  const style = { id: 'x', name: 'X', theme: 'classic', density: 'normal', design: {} } as CvStyle;
  upload('mine');
  assert.deepEqual((await cvRenderRequest(new MemoryStore(root), style)).themeFiles, { 'Preamble.j2.typ': 'x' });
  upload('mine', false);
  assert.deepEqual(
    (await cvRenderRequest(new MemoryStore(root), style)).themeFiles,
    {},
    'a disabled upload is ignored',
  );
  upload('../../config');
  await assert.rejects(cvRenderRequest(new MemoryStore(root), style), PathError);
});

test('renderCv maps 5xx to UpstreamError', async () => {
  stub(Response.json({ error: 'render failed' }, { status: 500 }));
  await assert.rejects(renderCv(req), UpstreamError);
});
