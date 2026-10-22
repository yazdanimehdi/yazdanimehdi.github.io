import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStore, githubConfig } from './github-store';
import { ConflictError, UpstreamError, gitBlobSha } from './store';

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> };
type Call = { method: string; path: string; body?: Record<string, any> };

/** Routes are "METHOD /path?query" relative to /repos/o/r; unmatched requests get 404. */
function fakeGitHub(routes: Record<string, (body: any, n: number) => Reply>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchFn = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const path = url.pathname.replace('/repos/o/r', '') + url.search;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const reply = routes[key]?.(body, n) ?? { status: 404, json: { message: 'Not Found' } };
    return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const cfg = { token: 't', owner: 'o', repo: 'r', branch: 'main' };
const author = { name: 'Jane', email: 'jane@users.noreply.github.com' };
const commitRoutes = (patch: (n: number) => Reply = () => ({ json: {} })) => ({
  'GET /git/ref/heads/main': () => ({ json: { object: { sha: 'head1' } } }),
  'GET /git/commits/head1': () => ({ json: { tree: { sha: 'tree1' } } }),
  'GET /contents/config/cv.yml?ref=head1': () => ({ json: { type: 'file', sha: 'cvsha' } }),
  'POST /git/blobs': (_: unknown, n: number) => ({ status: 201, json: { sha: `blob${n}` } }),
  'POST /git/trees': () => ({ status: 201, json: { sha: 'tree2' } }),
  'POST /git/commits': () => ({ status: 201, json: { sha: 'c2', html_url: 'https://github.com/o/r/commit/c2' } }),
  'PATCH /git/refs/heads/main': (_: unknown, n: number) => patch(n),
});

test('commit: blobs → tree on the head → commit with author → fast-forward ref', async () => {
  const { fetchFn, calls } = fakeGitHub(commitRoutes());
  const store = new GitHubStore(cfg, author, fetchFn);
  const result = await store.commit(
    [
      { path: 'config/cv.yml', content: 'cv: {}\n' },
      { path: 'src/content/posts/new.md', content: '---\ntitle: N\n---\n' },
      { path: 'public/images/x.png', content: 'iVBORw==', encoding: 'base64' },
    ],
    'Update CV',
    { 'config/cv.yml': 'cvsha', 'src/content/posts/new.md': null, 'public/images/x.png': null },
  );
  assert.deepEqual(result, {
    id: 'c2',
    url: 'https://github.com/o/r/commit/c2',
    versions: {
      'config/cv.yml': gitBlobSha('cv: {}\n'),
      'src/content/posts/new.md': gitBlobSha('---\ntitle: N\n---\n'),
      'public/images/x.png': gitBlobSha('iVBORw==', 'base64'),
    },
  });
  const blobs = calls.filter((c) => c.path === '/git/blobs').map((c) => c.body!.encoding);
  assert.deepEqual(blobs.sort(), ['base64', 'utf-8', 'utf-8']);
  const tree = calls.find((c) => c.path === '/git/trees')!.body!;
  assert.equal(tree.base_tree, 'tree1');
  assert.deepEqual(
    tree.tree.map((e: { path: string; mode: string }) => [e.path, e.mode]),
    [
      ['config/cv.yml', '100644'],
      ['src/content/posts/new.md', '100644'],
      ['public/images/x.png', '100644'],
    ],
  );
  const commit = calls.find((c) => c.method === 'POST' && c.path === '/git/commits')!.body!;
  assert.deepEqual(commit.parents, ['head1']);
  assert.equal(commit.message, 'Update CV');
  assert.equal(commit.author.email, 'jane@users.noreply.github.com');
  assert.deepEqual(calls.find((c) => c.method === 'PATCH')!.body, { sha: 'c2', force: false });
});

test('commit: a deletion is a null tree entry', async () => {
  const { fetchFn, calls } = fakeGitHub(commitRoutes());
  await new GitHubStore(cfg, author, fetchFn).commit([{ path: 'config/cv.yml', content: null }], 'Delete', {
    'config/cv.yml': 'cvsha',
  });
  assert.deepEqual(calls.find((c) => c.path === '/git/trees')!.body!.tree, [
    { path: 'config/cv.yml', mode: '100644', type: 'blob', sha: null },
  ]);
  assert.ok(!calls.some((c) => c.path === '/git/blobs'));
});

test('commit: a stale version is a conflict and nothing is written', async () => {
  const { fetchFn, calls } = fakeGitHub(commitRoutes());
  await assert.rejects(
    new GitHubStore(cfg, author, fetchFn).commit([{ path: 'config/cv.yml', content: 'x' }], 'm', {
      'config/cv.yml': 'old',
    }),
    ConflictError,
  );
  await assert.rejects(
    new GitHubStore(cfg, author, fetchFn).commit([{ path: 'config/cv.yml', content: 'x' }], 'm', {}),
    ConflictError,
    'missing base means "must not exist"',
  );
  assert.ok(!calls.some((c) => c.method !== 'GET'));
});

test('commit: a ref race is retried once from the top, then reported as a conflict', async () => {
  const race: Reply = { status: 422, json: { message: 'Update is not a fast forward' } };
  const once = fakeGitHub(commitRoutes((n) => (n === 1 ? race : { json: {} })));
  const ok = await new GitHubStore(cfg, author, once.fetchFn).commit([{ path: 'config/cv.yml', content: 'x' }], 'm', {
    'config/cv.yml': 'cvsha',
  });
  assert.equal(ok.id, 'c2');
  assert.equal(once.calls.filter((c) => c.path === '/git/ref/heads/main').length, 2);

  const always = fakeGitHub(commitRoutes(() => race));
  await assert.rejects(
    new GitHubStore(cfg, author, always.fetchFn).commit([{ path: 'config/cv.yml', content: 'x' }], 'm', {
      'config/cv.yml': 'cvsha',
    }),
    ConflictError,
  );
});

test('a 403 becomes a 502 naming the missing permission', async () => {
  const { fetchFn } = fakeGitHub({
    'GET /git/ref/heads/main': () => ({
      status: 403,
      json: { message: 'Resource not accessible by personal access token' },
      headers: { 'x-accepted-github-permissions': 'contents=write' },
    }),
  });
  await assert.rejects(
    new GitHubStore(cfg, author, fetchFn).commit([{ path: 'config/cv.yml', content: 'x' }], 'm', {}),
    (e) => e instanceof UpstreamError && e.status === 502 && /contents=write/.test(e.message) && /o\/r/.test(e.message),
  );
});

test('read decodes base64 and returns the blob sha; missing files are null', async () => {
  const { fetchFn } = fakeGitHub({
    'GET /contents/config/site.yml?ref=main': () => ({
      json: { type: 'file', sha: 's1', encoding: 'base64', content: Buffer.from('title: Hi\n').toString('base64') },
    }),
  });
  const store = new GitHubStore(cfg, author, fetchFn);
  assert.deepEqual(await store.read('config/site.yml'), {
    path: 'config/site.yml',
    content: 'title: Hi\n',
    version: 's1',
  });
  assert.equal(await store.read('config/nope.yml'), null);
});

test('list recurses into folders', async () => {
  const { fetchFn } = fakeGitHub({
    'GET /contents/public/images?ref=main': () => ({
      json: [
        { type: 'file', path: 'public/images/a.png', sha: 'a' },
        { type: 'dir', path: 'public/images/sub', sha: 'd' },
      ],
    }),
    'GET /contents/public/images/sub?ref=main': () => ({
      json: [{ type: 'file', path: 'public/images/sub/b.png', sha: 'b' }],
    }),
  });
  assert.deepEqual(await new GitHubStore(cfg, author, fetchFn).list('public/images'), [
    { path: 'public/images/a.png', version: 'a' },
    { path: 'public/images/sub/b.png', version: 'b' },
  ]);
});

test('githubConfig: explicit repo and branch win over Vercel metadata', () => {
  const vercel = {
    GITHUB_TOKEN: 't',
    VERCEL_GIT_REPO_OWNER: 'vo',
    VERCEL_GIT_REPO_SLUG: 'vr',
    VERCEL_GIT_COMMIT_REF: 'preview',
  };
  assert.deepEqual(githubConfig(vercel), { token: 't', owner: 'vo', repo: 'vr', branch: 'preview' });
  assert.deepEqual(githubConfig({ ...vercel, GITHUB_REPO: 'me/site', GITHUB_BRANCH: 'main' }), {
    token: 't',
    owner: 'me',
    repo: 'site',
    branch: 'main',
  });
  assert.throws(() => githubConfig({ GITHUB_REPO: 'me/site' }), /GITHUB_TOKEN/);
  assert.throws(() => githubConfig({ GITHUB_TOKEN: 't' }), /GITHUB_REPO/);
});

test('a missing branch is named as such, not as a token permission', async () => {
  const { fetchFn } = fakeGitHub({ 'GET ': () => ({ json: { id: 1 } }) });
  await assert.rejects(
    new GitHubStore(cfg, author, fetchFn).commit([{ path: 'config/cv.yml', content: 'x' }], 'm', {}),
    (e) =>
      e instanceof UpstreamError &&
      e.status === 502 &&
      e.message === 'Branch "main" was not found in o/r. Set GITHUB_BRANCH to an existing branch.',
  );
});

test('commit: deleting a file that does not exist is a conflict', async () => {
  const { fetchFn, calls } = fakeGitHub(commitRoutes());
  await assert.rejects(
    new GitHubStore(cfg, author, fetchFn).commit([{ path: 'config/gone.yml', content: null }], 'm', {
      'config/gone.yml': null,
    }),
    (e) => e instanceof ConflictError && e.path === 'config/gone.yml',
  );
  assert.ok(!calls.some((c) => c.method !== 'GET'));
});

test('capabilities probes the repo root, so a repo without config/site.yml is readable', async () => {
  const { fetchFn } = fakeGitHub({
    'GET /contents?ref=main': () => ({ json: [] }),
    'GET /actions/workflows?per_page=1': () => ({ json: { workflows: [] } }),
  });
  assert.deepEqual(await new GitHubStore(cfg, author, fetchFn).capabilities(), { contents: true, actions: true });
});

const REPO_OK = { 'GET ': () => ({ json: { id: 1 } }) };

test('a ref 404 on an unreadable repo blames the token, not the branch', async () => {
  const { fetchFn } = fakeGitHub({});
  await assert.rejects(
    new GitHubStore(cfg, author, fetchFn).commit([{ path: 'config/cv.yml', content: 'x' }], 'm', {}),
    (e) => e instanceof UpstreamError && /token needs/.test(e.message) && !/Branch/.test(e.message),
  );
});

test('capabilities reports a missing branch separately from an unreadable repo', async () => {
  const actions = { 'GET /actions/workflows?per_page=1': () => ({ json: {} }) };
  const missing = await new GitHubStore(cfg, author, fakeGitHub({ ...REPO_OK, ...actions }).fetchFn).capabilities();
  assert.equal(missing.contents, false);
  assert.equal(missing.error, 'Branch "main" was not found in o/r. Set GITHUB_BRANCH.');
  const denied = await new GitHubStore(cfg, author, fakeGitHub(actions).fetchFn).capabilities();
  assert.match(denied.error!, /token can't read o\/r/);
});

test('tree: blobs of the branch by path; null when the branch is missing', async () => {
  const { fetchFn } = fakeGitHub({
    'GET /git/trees/main?recursive=1': () => ({
      json: {
        truncated: false,
        tree: [
          { path: 'a.md', type: 'blob', sha: 's1' },
          { path: 'src', type: 'tree', sha: 't' },
        ],
      },
    }),
  });
  assert.deepEqual(await new GitHubStore(cfg, author, fetchFn).tree(), new Map([['a.md', 's1']]));
  const missing = fakeGitHub({});
  assert.equal(await new GitHubStore(cfg, author, missing.fetchFn).tree(), null);
});

test('createBranch: from the default branch head', async () => {
  const { fetchFn, calls } = fakeGitHub({
    'GET ': () => ({ json: { default_branch: 'main' } }),
    'GET /git/ref/heads/main': () => ({ json: { object: { sha: 'head1' } } }),
    'POST /git/refs': () => ({ status: 201, json: {} }),
  });
  await new GitHubStore({ ...cfg, branch: 'content-backup' }, author, fetchFn).createBranch();
  assert.deepEqual(calls.at(-1), {
    method: 'POST',
    path: '/git/refs',
    body: { ref: 'refs/heads/content-backup', sha: 'head1' },
  });
});

test('revertChanges: each file the commit touched back to its parent’s content, based on the blobs it left', async () => {
  const content = (text: string) => ({
    json: {
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(text)
        .toString('base64')
        .replace(/(.{4})/g, '$1\n'),
    },
  });
  const { fetchFn } = fakeGitHub({
    'GET /commits/abc': () => ({
      json: {
        commit: { message: 'Site editor: x\n\nSite-editor: publish' },
        parents: [{ sha: 'p1' }],
        files: [
          { filename: 'a.astro', status: 'modified', sha: 'a2' },
          { filename: 'new.astro', status: 'added', sha: 'n1' },
          { filename: 'gone.md', status: 'removed', sha: 'g1' },
          { filename: 'to.css', status: 'renamed', sha: 't1', previous_filename: 'from.css' },
        ],
      },
    }),
    'GET /contents/a.astro?ref=p1': () => content('a v1\n'),
    'GET /contents/gone.md?ref=p1': () => content('gone\n'),
    'GET /contents/from.css?ref=p1': () => content('css\n'),
    'GET /commits/merge': () => ({
      json: { commit: { message: 'm' }, parents: [{ sha: '1' }, { sha: '2' }], files: [] },
    }),
  });
  const store = new GitHubStore(cfg, author, fetchFn);
  const r = await store.revertChanges('abc');
  assert.equal(r.message, 'Site editor: x\n\nSite-editor: publish');
  const text = Object.fromEntries(
    r.changes.map((c) => [c.path, c.content === null ? null : Buffer.from(c.content, 'base64').toString()]),
  );
  assert.deepEqual(text, {
    'a.astro': 'a v1\n',
    'new.astro': null,
    'gone.md': 'gone\n',
    'from.css': 'css\n',
    'to.css': null,
  });
  assert.ok(r.changes.every((c) => c.content === null || (c.encoding === 'base64' && !/\s/.test(c.content))));
  assert.deepEqual(r.base, { 'a.astro': 'a2', 'new.astro': 'n1', 'gone.md': null, 'from.css': null, 'to.css': 't1' });
  await assert.rejects(store.revertChanges('merge'), (e: UpstreamError) => e.status === 409);
  await assert.rejects(store.revertChanges('nope'), (e: UpstreamError) => e.status === 404);
});

test('latestCommitWith: the newest of the branch’s recent commits with the trailer as a whole line', async () => {
  const { fetchFn, calls } = fakeGitHub({
    'GET /commits?sha=main&per_page=100': () => ({
      json: [
        { sha: 'undo', commit: { message: 'Undo: Site editor: x' } },
        { sha: 'quoted', commit: { message: 'Mentions Site-editor: publish mid-line' } },
        { sha: 'newer', commit: { message: 'Site editor: y\n\nSite-editor: publish' } },
        { sha: 'older', commit: { message: 'Site editor: x\n\nSite-editor: publish' } },
      ],
    }),
  });
  const store = new GitHubStore(cfg, author, fetchFn);
  assert.equal(await store.latestCommitWith('Site-editor: publish'), 'newer');
  assert.equal(calls[0].path, '/commits?sha=main&per_page=100', 'the deployed branch');
  assert.equal(await store.latestCommitWith('Nope: never'), null);
});

test('readPdf: the raw bytes of a site-folder PDF on the branch; other URLs are never requested', async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);
  const seen: Request[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    return req.url.includes('/contents/public/images/mirage-abc123.pdf?ref=main')
      ? new Response(pdf)
      : new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  const store = new GitHubStore(cfg, author, fetchFn);
  assert.deepEqual(new Uint8Array((await store.readPdf('/images/mirage-abc123.pdf'))!), pdf);
  assert.equal(seen[0].url, 'https://api.github.com/repos/o/r/contents/public/images/mirage-abc123.pdf?ref=main');
  assert.equal(seen[0].headers.get('accept'), 'application/vnd.github.raw+json');
  assert.equal(await store.readPdf('/images/gone-abc123.pdf'), null);
  assert.equal(await store.readPdf('https://example.com/images/x.pdf'), null);
  assert.equal(seen.length, 2);
});
