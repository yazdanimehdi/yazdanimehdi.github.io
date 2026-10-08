import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { gitBlobSha } from './store';
import { MediumError, absoluteUrls, crossPost, mediumPayload } from './medium';
import { POST as medium } from '../../admin/routes/api/posts/[slug]/medium';

const POST_URL = 'https://example.com/blog/hello/';

test('mediumPayload: headings, absolute URLs, canonical link, five tags, draft', () => {
  const body =
    '![Fig](/images/fig.png) and [next](../other/) and [ext](https://x.org/a) and [top](#intro).\n\n' +
    '<img src="/images/raw.png"> Math $a_1 + b$ stays.';
  const p = mediumPayload({ title: 'Hello', subtitle: 'World', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, body, POST_URL);
  assert.equal(p.title, 'Hello');
  assert.equal(p.contentFormat, 'markdown');
  assert.equal(p.canonicalUrl, POST_URL);
  assert.equal(p.publishStatus, 'draft');
  assert.deepEqual(p.tags, ['a', 'b', 'c', 'd', 'e']);
  assert.ok(p.content.startsWith('# Hello\n\n## World\n\n'));
  assert.match(p.content, /!\[Fig\]\(https:\/\/example\.com\/images\/fig\.png\)/);
  assert.match(p.content, /\[next\]\(https:\/\/example\.com\/blog\/other\/\)/);
  assert.match(p.content, /\[ext\]\(https:\/\/x\.org\/a\)/);
  assert.match(p.content, /\[top\]\(#intro\)/);
  assert.match(p.content, /<img src="https:\/\/example\.com\/images\/raw\.png">/);
  assert.match(p.content, /\$a_1 \+ b\$/);
  assert.equal(mediumPayload({ title: 'T' }, '', POST_URL).content, '# T\n\n');
});

test('absoluteUrls: leaves mailto:, protocol-relative and absolute URLs alone', () => {
  const md = '[m](mailto:a@b.c) [p](//cdn.x/y.png) [h](http://x.y)';
  assert.equal(absoluteUrls(md, POST_URL), md);
});

const fakeFetch = (responses: Record<string, { status: number; body: unknown }>, seen: Request[] = []) =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    const hit = responses[`${req.method} ${req.url}`];
    if (!hit) throw new Error(`unexpected ${req.method} ${req.url}`);
    return new Response(JSON.stringify(hit.body), {
      status: hit.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

const OK = {
  'GET https://api.medium.com/v1/me': { status: 200, body: { data: { id: 'u1' } } },
  'POST https://api.medium.com/v1/users/u1/posts': {
    status: 201,
    body: { data: { id: 'p9', url: 'https://medium.com/@jane/hello-p9' } },
  },
};

test('crossPost: the token user, then a draft post', async () => {
  const seen: Request[] = [];
  const result = await crossPost('tok', mediumPayload({ title: 'Hello' }, 'Hi', POST_URL), fakeFetch(OK, seen));
  assert.deepEqual(result, { id: 'p9', url: 'https://medium.com/@jane/hello-p9' });
  assert.equal(seen[0].headers.get('authorization'), 'Bearer tok');
  assert.equal((await seen[1].json()).publishStatus, 'draft');
});

test('crossPost: a rejected token is a MediumError naming the 401', async () => {
  const bad = {
    'GET https://api.medium.com/v1/me': { status: 401, body: { errors: [{ message: 'Token was invalid.' }] } },
  };
  await assert.rejects(crossPost('tok', mediumPayload({ title: 'T' }, '', POST_URL), fakeFetch(bad)), (e: unknown) => {
    assert.ok(e instanceof MediumError);
    assert.match((e as Error).message, /rejected the token \(401\): Token was invalid\./);
    return true;
  });
});

// ── the route ──
let store: MemoryStore;
const user = { login: 'jane', name: 'Jane', avatar: '' };
const call = (slug: string, body?: unknown) =>
  medium({
    request: new Request('https://site.test/api/admin/posts/x/medium', {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url: new URL('https://site.test/api/admin/posts/x/medium'),
    params: { slug },
    locals: { user },
  } as never);
const seed = (slug: string, front: string) =>
  store.commit(
    [{ path: `src/content/posts/${slug}.md`, content: `---\n${front}\n---\n\nBody ![i](/images/i.png)\n` }],
    'seed',
    {},
  );

beforeEach(() => {
  store = new MemoryStore();
  setStoreForTests(() => store);
});

test('route: sends once, records medium.url/id in front matter, then refuses a second time', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN, fetch: globalThis.fetch };
  process.env.MEDIUM_TOKEN = 'tok';
  globalThis.fetch = fakeFetch(OK);
  try {
    await seed('hello', 'title: Hello\ndate: 2024-06-01');
    const res = await call('hello');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.medium, { id: 'p9', url: 'https://medium.com/@jane/hello-p9' });
    const file = (await store.read('src/content/posts/hello.md'))!;
    assert.match(file.content, /medium:\n {2}url: https:\/\/medium\.com\/@jane\/hello-p9\n {2}id: p9\n/);
    assert.equal(body.versions['src/content/posts/hello.md'], file.version);
    const again = await call('hello');
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /Already on Medium/);
  } finally {
    process.env.MEDIUM_TOKEN = saved.token;
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    globalThis.fetch = saved.fetch;
  }
});

test('route: no token → 400; drafts → 400; unknown → 404; Medium failure → 502 and nothing written', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN, fetch: globalThis.fetch };
  try {
    delete process.env.MEDIUM_TOKEN;
    await seed('hello', 'title: Hello\ndate: 2024-06-01');
    assert.equal((await call('hello')).status, 400);
    process.env.MEDIUM_TOKEN = 'tok';
    await seed('wip', 'title: WIP\ndate: 2024-06-01\ndraft: true');
    assert.equal((await call('wip')).status, 400);
    assert.equal((await call('nope')).status, 404);
    globalThis.fetch = fakeFetch({ 'GET https://api.medium.com/v1/me': { status: 401, body: {} } });
    const before = (await store.read('src/content/posts/hello.md'))!.content;
    const failed = await call('hello');
    assert.equal(failed.status, 502);
    assert.equal((await store.read('src/content/posts/hello.md'))!.content, before);
  } finally {
    process.env.MEDIUM_TOKEN = saved.token;
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    globalThis.fetch = saved.fetch;
  }
});

test('absoluteUrls: code spans and fenced blocks untouched; balanced parentheses in targets', () => {
  const md = 'See [x](/a) and `[y](/b)`.\n\n```\n![z](/c)\n```\n\n[wiki](/w/Foo_(bar))';
  const out = absoluteUrls(md, 'https://example.com/blog/p/');
  assert.match(out, /\[x\]\(https:\/\/example\.com\/a\)/);
  assert.match(out, /`\[y\]\(\/b\)`/);
  assert.match(out, /```\n!\[z\]\(\/c\)\n```/);
  assert.match(out, /\[wiki\]\(https:\/\/example\.com\/w\/Foo_\(bar\)\)/);
});

test('route: scheduled posts are refused until their date', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN };
  process.env.MEDIUM_TOKEN = 'tok';
  try {
    await seed('later', 'title: Later\ndate: 2999-01-01');
    const res = await call('later');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /once it is live \(2999-01-01\)/);
  } finally {
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    else process.env.MEDIUM_TOKEN = saved.token;
  }
});

test('route: MDX posts 409; a version that never shows up 409 "still saving"', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN };
  process.env.MEDIUM_TOKEN = 'tok';
  try {
    await store.commit(
      [{ path: 'src/content/posts/old.mdx', content: '---\ntitle: Old\ndate: 2024-01-01\n---\n' }],
      's',
      {},
    );
    assert.equal((await call('old')).status, 409);
    await seed('hello', 'title: Hello\ndate: 2024-06-01');
    const res = await call('hello', { version: 'not-the-version' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /still saving/);
  } finally {
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    else process.env.MEDIUM_TOKEN = saved.token;
  }
});

test('route: without siteUrl the canonical URL uses the request origin', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN, fetch: globalThis.fetch };
  process.env.MEDIUM_TOKEN = 'tok';
  const seen: Request[] = [];
  globalThis.fetch = fakeFetch(OK, seen);
  try {
    const site = (await store.read('config/site.yml'))!;
    await store.commit(
      [{ path: 'config/site.yml', content: site.content.replace(/^siteUrl:.*$/m, "siteUrl: ''") }],
      's',
      { 'config/site.yml': site.version },
    );
    await seed('hello', 'title: Hello\ndate: 2024-06-01');
    assert.equal((await call('hello')).status, 200);
    assert.equal((await seen[1].json()).canonicalUrl, 'https://site.test/blog/hello/');
  } finally {
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    else process.env.MEDIUM_TOKEN = saved.token;
    globalThis.fetch = saved.fetch;
  }
});

test('route: a brand-new post that is not readable yet is waited for; one that never appears is 404', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN, fetch: globalThis.fetch };
  process.env.MEDIUM_TOKEN = 'tok';
  globalThis.fetch = fakeFetch(OK);
  try {
    const content = '---\ntitle: Fresh\ndate: 2024-06-01\n---\n\nBody\n';
    const pending = call('fresh', { version: gitBlobSha(content) });
    setTimeout(() => store.commit([{ path: 'src/content/posts/fresh.md', content }], 'save', {}), 100);
    assert.equal((await pending).status, 200);
    assert.equal((await call('never', { version: 'v' })).status, 404);
  } finally {
    process.env.MEDIUM_TOKEN = saved.token;
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    globalThis.fetch = saved.fetch;
  }
});
