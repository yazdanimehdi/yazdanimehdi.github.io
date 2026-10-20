import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { POST as aiImage } from '../../admin/routes/api/ai/image';
import { POST as aiText } from '../../admin/routes/api/ai/text';

const KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'HIGGSFIELD_API_KEY',
  'HIGGSFIELD_API_SECRET',
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;
let store: MemoryStore;
let sent: Request[];

beforeEach(() => {
  store = new MemoryStore();
  setStoreForTests(() => store);
  for (const k of KEYS) delete process.env[k];
  sent = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

/** Every outgoing request answers `body`. */
function provider(body: unknown, status = 200) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const user = { login: 'jane', name: 'Jane', avatar: '' };
function call(handler: (ctx: never) => Response | Promise<Response>, body: unknown, signedIn = true) {
  const url = new URL('https://site.test/api/admin/ai/x');
  const request = new Request(url, { method: 'POST', body: JSON.stringify(body) });
  return Promise.resolve(handler({ request, url, params: {}, locals: signedIn ? { user } : {} } as never));
}

test('AI routes need a session', async () => {
  assert.equal((await call(aiText, { action: 'write', collection: 'posts', title: 'T' }, false)).status, 401);
  assert.equal((await call(aiImage, { collection: 'posts', title: 'T' }, false)).status, 401);
});

test('text: no key is a 400 naming the key and the AI screen; nothing is sent', async () => {
  provider({});
  const res = await call(aiText, { action: 'write', collection: 'posts', title: 'Hello' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /ANTHROPIC_API_KEY is not set: add it on the Scholar & AI screen/);
  assert.equal(sent.length, 0);
});

test('text: write goes to the configured provider and comes back as clean Markdown', async () => {
  process.env.ANTHROPIC_API_KEY = 'ak';
  provider({ content: [{ type: 'text', text: '```markdown\nDraft **body**\n```' }] });
  const res = await call(aiText, { action: 'write', collection: 'posts', title: 'Hello', instruction: 'short' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: 'Draft **body**\n' });
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.match((await sent[0].json()).messages[0].content, /Title: Hello/);
  assert.equal(store.log.length, 0, 'nothing is committed');
});

test('text: bad requests are 400s; a provider failure is a 502 with its message', async () => {
  process.env.ANTHROPIC_API_KEY = 'ak';
  provider({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
  const status = async (body: unknown) => (await call(aiText, body)).status;
  assert.equal(await status({ action: 'rewrite', collection: 'posts', body: '  ' }), 400);
  assert.equal(await status({ action: 'write', collection: 'posts' }), 400);
  assert.equal(await status({ action: 'write', collection: 'people', title: 'T' }), 400);
  assert.equal(await status({ action: 'delete', collection: 'posts', title: 'T' }), 400);
  assert.equal(await status({ action: 'rewrite', collection: 'posts', body: 'x'.repeat(100_001) }), 400);
  assert.equal(sent.length, 0);
  const res = await call(aiText, { action: 'rewrite', collection: 'announcements', body: 'Old text' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Anthropic rejected the key \(401\): invalid x-api-key/);
});

test('image: no key is a 400; with one the image is stored as content media and its URL returned', async () => {
  provider({});
  const missing = await call(aiImage, { collection: 'posts', title: 'Robots' });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /OPENAI_API_KEY is not set/);

  process.env.OPENAI_API_KEY = 'sk';
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]).toString('base64');
  provider({ data: [{ b64_json: jpeg }] });
  const res = await call(aiImage, { collection: 'posts', title: 'Robots that learn', excerpt: 'About robots' });
  assert.equal(res.status, 200);
  const upload = await res.json();
  assert.match(upload.path, /\/robots-that-learn-[0-9a-f]{6}\.jpg$/);
  assert.ok(await store.read(upload.path), 'stored');
  assert.match((await sent[0].json()).prompt, /"Robots that learn"[\s\S]*About robots/);
});

test('image: publications get a figure prompt from the title and abstract', async () => {
  process.env.OPENAI_API_KEY = 'sk';
  provider({ data: [{ b64_json: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64') }] });
  const res = await call(aiImage, {
    collection: 'publications',
    title: 'Sparse attention',
    abstract: 'We prune heads.',
  });
  assert.equal(res.status, 200);
  const prompt = (await sent[0].json()).prompt;
  assert.match(prompt, /research paper titled "Sparse attention"/);
  assert.match(prompt, /Abstract: We prune heads\./);
});

test('image: motion needs the Higgsfield keys, whichever image provider is configured; nothing is sent', async () => {
  process.env.OPENAI_API_KEY = 'sk';
  provider({});
  const none = await call(aiImage, { collection: 'posts', title: 'Robots', motion: true });
  assert.equal(none.status, 400);
  assert.match((await none.json()).error, /HIGGSFIELD_API_KEY is not set/);
  process.env.HIGGSFIELD_API_KEY = 'id';
  const half = await call(aiImage, { collection: 'publications', title: 'Robots', motion: true });
  assert.equal(half.status, 400);
  assert.match((await half.json()).error, /HIGGSFIELD_API_SECRET is not set/);
  assert.equal(sent.length, 0);
});

test('image: motion animates the Higgsfield still and stores an animated WebP', async () => {
  process.env.HIGGSFIELD_API_KEY = 'id';
  process.env.HIGGSFIELD_API_SECRET = 'secret';
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-routes-test-'));
  const clip = path.join(dir, 'clip.mp4');
  execFileSync(ffmpegPath!, ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', clip], { stdio: 'pipe' });
  const mp4 = readFileSync(clip);
  rmSync(dir, { recursive: true, force: true });
  const still = 'https://cdn.higgsfield.ai/still.jpg';
  const replies: Record<string, () => Response> = {
    'https://api.higgsfield.ai/higgsfield-ai/soul/standard': () =>
      Response.json({ status: 'completed', request_id: 'i1', images: [{ url: still }] }),
    [still]: () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
    'https://api.higgsfield.ai/bytedance/seedance-2.5/image-to-video': () =>
      Response.json({ status: 'completed', request_id: 'v1', video: { url: 'https://cdn.higgsfield.ai/v1.mp4' } }),
    'https://cdn.higgsfield.ai/v1.mp4': () => new Response(mp4),
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    sent.push(req);
    return replies[req.url]();
  }) as typeof fetch;
  const res = await call(aiImage, { collection: 'publications', title: 'Sparse attention', motion: true });
  assert.equal(res.status, 200);
  const upload = await res.json();
  assert.match(upload.path, /\/sparse-attention-[0-9a-f]{6}\.webp$/);
  assert.ok((await store.read(upload.path))?.content.includes('ANIM'), 'stored as an animated WebP');
  assert.equal((await sent[2].json()).image_url, still);
});
