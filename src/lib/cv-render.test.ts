import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { CvRenderError, renderCv, type CvRenderRequest } from './cv-render';
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
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CV_RENDER_URL;
  delete process.env.SESSION_SECRET;
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

test('renderCv maps 422 to CvRenderError', async () => {
  stub(Response.json({ error: 'bad margin' }, { status: 422 }));
  await assert.rejects(renderCv(req), (e) => e instanceof CvRenderError && e.message === 'bad margin');
});

test('renderCv maps 5xx to UpstreamError', async () => {
  stub(Response.json({ error: 'render failed' }, { status: 500 }));
  await assert.rejects(renderCv(req), UpstreamError);
});
