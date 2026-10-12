import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SCRIPTS,
  discardChanges,
  endSession,
  publish,
  sessionStatus,
  startRun,
  startOver,
  startSession,
  type CommandResult,
  type EditorContext,
  type EditorStatus,
  type NetworkPolicy,
  type SandboxApi,
  type SandboxHandle,
} from './editor';
import { HttpError } from './http';
import { MemoryStore } from './memory-store';
import { ConflictError, UpstreamError, blobVersions, gitBlobSha, type Change, type ContentStore } from './store';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@t',
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
const OK: CommandResult = { exitCode: 0, stdout: '', stderr: '' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff]);

/** A sandbox that is a temp folder: /vercel/… maps into it and scripts run in the local bash, except stubbed ones. */
class LocalSandbox implements SandboxHandle {
  status = 'running';
  calls: { script: string; args: string[]; env: Record<string, string>; detached: boolean }[] = [];
  policies: NetworkPolicy[] = [];
  extended = 0;
  /** npm, `astro dev` and its wait loop: nothing to install or serve here. */
  static stubbed = new Set<string>([SCRIPTS.install, SCRIPTS.dev, SCRIPTS.waitDev]);
  stubs = LocalSandbox.stubbed;

  constructor(
    readonly root: string,
    private remote: string,
  ) {}

  local = (s: string) =>
    s.replaceAll('/vercel/', `${this.root}/`).replace(/^https:\/\/github\.com\/.*\.git$/, this.remote);

  private env(env: Record<string, string>) {
    return { ...process.env, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, this.local(v)])) };
  }

  async run(script: string, args: string[] = [], opts: { env?: Record<string, string> } = {}) {
    this.calls.push({ script, args, env: opts.env ?? {}, detached: false });
    if (this.stubs.has(script)) return OK;
    const r = spawnSync('bash', ['-c', script, 'bash', ...args.map(this.local)], {
      env: this.env(opts.env ?? {}),
      encoding: 'utf8',
    });
    return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  }

  async spawn(script: string, args: string[] = [], env: Record<string, string> = {}) {
    this.calls.push({ script, args, env, detached: true });
    if (this.stubs.has(script)) return;
    spawn('bash', ['-c', script, 'bash', ...args.map(this.local)], {
      env: this.env(env),
      detached: true,
      stdio: 'ignore',
    }).unref();
  }

  async readFile(p: string) {
    try {
      return fs.readFileSync(this.local(p));
    } catch {
      return null;
    }
  }

  async writeFiles(files: { path: string; content: Buffer }[]) {
    for (const f of files) {
      fs.mkdirSync(path.dirname(this.local(f.path)), { recursive: true });
      fs.writeFileSync(this.local(f.path), f.content);
    }
  }

  domain(port: number) {
    return `https://sb-${port}.vercel.run`;
  }

  async setNetworkPolicy(policy: NetworkPolicy) {
    this.policies.push(policy);
  }

  async extendTimeout() {
    this.extended++;
  }

  async stop() {
    this.status = 'stopped';
  }

  async delete() {
    this.status = 'deleted';
    fs.rmSync(this.root, { recursive: true, force: true });
  }

  called(script: string) {
    return this.calls.filter((c) => c.script === script);
  }
}

class FakeApi implements SandboxApi {
  /** Every sandbox created, the current one last. */
  all: LocalSandbox[] = [];
  createdWith: NetworkPolicy[] = [];

  constructor(private make: () => LocalSandbox) {}

  get sandbox() {
    const last = this.all.at(-1);
    return last && last.status !== 'deleted' ? last : null;
  }

  async get(_name: string, opts: { resume?: boolean } = {}) {
    if (this.sandbox && opts.resume) this.sandbox.status = 'running';
    return this.sandbox;
  }

  async create(_name: string, opts: { networkPolicy: NetworkPolicy }) {
    assert.equal(this.sandbox, null, 'one sandbox per site');
    this.createdWith.push(opts.networkPolicy);
    this.all.push(this.make());
    return this.all.at(-1)!;
  }

  calls() {
    return this.all.flatMap((s) => s.calls);
  }
}

/** The GitHub store as publish sees it: records commits, or fails with `fail`. */
function codeStore(order: string[] = []) {
  const commits: { changes: Change[]; message: string; base: Record<string, string | null> }[] = [];
  const store = {
    commits,
    fail: null as Error | null,
    async commit(changes: Change[], message: string, base: Record<string, string | null>) {
      order.push('code');
      if (store.fail) throw store.fail;
      commits.push({ changes, message, base });
      const id = `c${commits.length}`;
      return { id, url: `https://github.com/jane/site/commit/${id}`, versions: blobVersions(changes) };
    },
  };
  return store;
}

let root: string;
let work: string;
let api: FakeApi;
let code: ReturnType<typeof codeStore>;
const savedPath = process.env.PATH;

const write = (dir: string, files: Record<string, string | Buffer>) => {
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), content);
  }
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-'));
  work = path.join(root, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  write(work, {
    'package.json': '{}\n',
    'src/components/Header.astro': 'header v1\n',
    'src/pages/index.astro': 'index v1\n',
    'src/pages/old-name.astro': 'to rename\n',
    'public/remove-me.txt': 'bye\n',
    'config/site.yml': 'title: v1\n',
    'src/content/posts/hello.md': 'hello from git\n',
    'src/content/posts/gone.md': 'deleted in the database\n',
    'src/admin/x.ts': 'admin\n',
    '.gitignore': 'tracked-but-ignored.txt\n',
    'tracked-but-ignored.txt': 'committed before it was ignored\n',
  });
  git(work, 'add', '-A');
  git(work, 'add', '-f', 'tracked-but-ignored.txt');
  git(work, 'commit', '-q', '-m', 'init');
  git(root, 'clone', '-q', '--bare', work, 'remote.git');
  git(work, 'remote', 'add', 'origin', path.join(root, 'remote.git'));
  api = new FakeApi(() => new LocalSandbox(path.join(root, 'vm'), `file://${path.join(root, 'remote.git')}`));
  code = codeStore();
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(root, { recursive: true, force: true });
});

function context(over: Partial<EditorContext> = {}): EditorContext {
  return {
    api,
    name: 'site-editor-jane-site',
    github: { token: 'ghp_SECRET', owner: 'jane', repo: 'site', branch: 'main' },
    agent: { provider: 'anthropic', model: 'claude-test', key: 'sk-ant-REAL' },
    code: code as unknown as ContentStore,
    docs: null,
    by: 'jane',
    ...over,
  };
}

const site = (p = '') => path.join(root, 'vm/site', p);
const state = () => JSON.parse(fs.readFileSync(path.join(root, 'vm/editor/state.json'), 'utf8'));
const ready = (s: EditorStatus) => {
  assert.equal(s.state, 'ready');
  return s as Extract<EditorStatus, { state: 'ready' }>;
};

/** A fake `claude` on PATH: prints its argv NUL-separated, then waits for $EDITOR/release unless `wait` is false. */
function fakeClaude(wait = true) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done\n${wait ? 'while [ ! -f "$EDITOR/release" ]; do sleep 0.05; done\n' : ''}`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${savedPath}`;
}

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(check(), 'condition reached');
}

async function finishedRun(c: EditorContext, prompt: string) {
  fakeClaude(false);
  const run = await startRun(c, prompt);
  await until(() => fs.existsSync(path.join(root, `vm/editor/runs/${run.id}.exit`)));
  return run;
}

test('start clones the deployed branch with the token only in git’s environment, installs, and opens the preview', async () => {
  const s = ready(await startSession(context()));
  const sb = api.sandbox!;
  assert.equal(s.previewUrl, 'https://sb-4321.vercel.run');
  assert.deepEqual(s.files, []);

  const [clone] = sb.called(SCRIPTS.clone);
  assert.deepEqual(clone.args, ['https://github.com/jane/site.git', 'main']);
  assert.equal(clone.env.GIT_TOKEN, 'ghp_SECRET');
  assert.equal(clone.env.GIT_CONFIG_KEY_0, 'credential.helper');
  const others = sb.calls.filter((c) => c !== clone);
  assert.ok(!JSON.stringify(clone.env.GIT_CONFIG_VALUE_0).includes('ghp_SECRET'), 'the helper reads it from the env');
  assert.ok(!JSON.stringify(others).includes('ghp_SECRET'), 'no other command sees the token');
  assert.ok(!JSON.stringify(clone.args).includes('ghp_SECRET'), 'nor the clone’s argv');
  assert.ok(!fs.readFileSync(site('.git/config'), 'utf8').includes('ghp_SECRET'), 'nor .git/config');
  assert.equal(state().baseSha, git(work, 'rev-parse', 'HEAD').trim());

  const order = sb.calls.map((c) => c.script);
  assert.ok(order.indexOf(SCRIPTS.install) > order.indexOf(SCRIPTS.clone), 'installs after cloning');
  assert.ok(order.indexOf(SCRIPTS.dev) > order.indexOf(SCRIPTS.install), 'starts the dev server last');
  assert.equal(sb.called(SCRIPTS.waitDev).length, 1);

  assert.ok(api.createdWith[0].allow['github.com'], 'the first clone may reach GitHub');
  const final = sb.policies.at(-1)!;
  assert.equal(final.allow['github.com'], undefined, 'then GitHub is closed again');
  assert.deepEqual(final.allow['api.anthropic.com'], [{ transform: [{ headers: { 'x-api-key': 'sk-ant-REAL' } }] }]);

  ready(await startSession(context()));
  assert.equal(sb.called(SCRIPTS.clone).length, 1, 'a resumed session keeps its checkout');
  assert.equal(sb.called(SCRIPTS.dev).length, 2, 'and restarts the dev server');
});

test('Postgres mode: start exports every document over the checkout and records their versions', async () => {
  const db = path.join(root, 'db');
  write(db, {
    'config/site.yml': 'title: from the database\n',
    'src/content/posts/hello.md': 'hello from the database\n',
    'src/content/posts/new.md': 'only in the database\n',
  });
  const s = ready(await startSession(context({ docs: new MemoryStore(db) })));

  assert.deepEqual(s.files, [], 'the export is the base, not a change');
  assert.equal(fs.readFileSync(site('config/site.yml'), 'utf8'), 'title: from the database\n');
  assert.equal(fs.readFileSync(site('src/content/posts/new.md'), 'utf8'), 'only in the database\n');
  assert.ok(!fs.existsSync(site('src/content/posts/gone.md')), 'documents the database deleted are gone');
  assert.ok(fs.existsSync(site('src/admin/x.ts')), 'code is untouched');
  assert.deepEqual(state().docVersions, {
    'config/site.yml': gitBlobSha('title: from the database\n'),
    'src/content/posts/hello.md': gitBlobSha('hello from the database\n'),
    'src/content/posts/new.md': gitBlobSha('only in the database\n'),
  });
});

test('status lists renames, untracked files, deletions and binaries, each allowed or refused, with the diff', async () => {
  await startSession(context());
  write(site(), {
    'src/components/Header.astro': 'header v2\n',
    'src/components/New.astro': 'new\n',
    'public/logo.png': PNG,
    'src/admin/x.ts': 'hacked\n',
  });
  fs.renameSync(site('src/pages/old-name.astro'), site('src/pages/new-name.astro'));
  fs.rmSync(site('public/remove-me.txt'));

  const s = ready(await sessionStatus(context()));
  const files = [...s.files].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(files, [
    { path: 'public/logo.png', status: 'added', binary: true, allowed: true },
    { path: 'public/remove-me.txt', status: 'deleted', binary: false, allowed: true },
    { path: 'src/admin/x.ts', status: 'modified', binary: false, allowed: false },
    { path: 'src/components/Header.astro', status: 'modified', binary: false, allowed: true },
    { path: 'src/components/New.astro', status: 'added', binary: false, allowed: true },
    { path: 'src/pages/new-name.astro', status: 'added', binary: false, allowed: true },
    { path: 'src/pages/old-name.astro', status: 'deleted', binary: false, allowed: true },
  ]);
  assert.match(s.diff, /-header v1\n\+header v2/);
  assert.equal(s.diffTruncated, false);
  assert.equal(git(site(), 'status', '--porcelain').includes('A '), false, 'the agent’s own index is untouched');
});

test('run starts the agent detached with a placeholder key, the prompt as one argv element, and the real key only in the network policy', async () => {
  const c = context();
  await startSession(c);
  const sb = api.sandbox!;
  fakeClaude();
  const prompt = `Make it "bold" and 'quoted' $(touch pwned) \`touch pwned2\` $HOME
second line; touch pwned3`;
  const run = await startRun(c, prompt);

  const [spawned] = sb.calls.filter((x) => x.script === SCRIPTS.run);
  assert.equal(spawned.detached, true);
  assert.equal(spawned.args[0], run.id);
  assert.equal(spawned.args[1], 'claude');
  assert.equal(spawned.env.ANTHROPIC_API_KEY, 'brokered-by-the-sandbox-firewall');
  assert.ok(!JSON.stringify(sb.calls).includes('sk-ant-REAL'), 'no command sees the key');
  assert.deepEqual(sb.policies.at(-1)!.allow['api.anthropic.com'], [
    { transform: [{ headers: { 'x-api-key': 'sk-ant-REAL' } }] },
  ]);
  assert.ok(sb.extended > 0, 'the session is extended');

  await assert.rejects(startRun(c, 'another'), (e: HttpError) => e.status === 409);
  const log = path.join(root, `vm/editor/runs/${run.id}.log`);
  await until(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('--verbose'));
  const argv = fs.readFileSync(log, 'utf8').split('\0');
  const sent = argv[argv.indexOf('-p') + 1];
  assert.ok(sent.endsWith(`The request:\n${prompt}`), 'the prompt arrives verbatim');
  assert.match(sent, /never a \.ts or \.js file there/);
  assert.match(sent, /Never read process\.env or import\.meta\.env/);
  assert.equal(argv.includes('--continue'), false, 'the first run starts a conversation');
  for (const f of ['pwned', 'pwned2', 'pwned3']) assert.ok(!fs.existsSync(site(f)), `${f}: nothing was executed`);

  const running = ready(await sessionStatus(c));
  assert.equal(running.run?.running, true);
  fs.writeFileSync(path.join(root, 'vm/editor/release'), '');
  await until(() => fs.existsSync(path.join(root, `vm/editor/runs/${run.id}.exit`)));
  const devBefore = sb.called(SCRIPTS.dev).length;
  const done = ready(await sessionStatus(c));
  assert.equal(done.run?.running, false);
  assert.equal(done.run?.exitCode, 0);
  assert.equal(sb.called(SCRIPTS.dev).length, devBefore + 1, 'the dev server restarts once after a run');
  await sessionStatus(c);
  assert.equal(sb.called(SCRIPTS.dev).length, devBefore + 1, 'only once');

  await startRun(c, 'next');
  const [, second] = sb.calls.filter((x) => x.script === SCRIPTS.run);
  assert.ok(second.args.includes('--continue'), 'later runs continue the conversation');
});

test('a run still starts when the plan won’t extend the session any further', async () => {
  const c = context();
  await startSession(c);
  api.sandbox!.extendTimeout = async () => {
    throw new UpstreamError('Vercel Sandbox: extending the session failed: would exceed maximum execution timeout');
  };
  fakeClaude(false);
  assert.ok((await startRun(c, 'x')).id);
});

test('run, publish and discard need a running session', async () => {
  const c = context();
  await assert.rejects(startRun(c, 'x'), (e: HttpError) => e.status === 409);
  await assert.rejects(publish(c), (e: HttpError) => e.status === 409);
  await startSession(c);
  await assert.rejects(startRun(c, '  '), (e: HttpError) => e.status === 400);
  await endSession(c);
  await assert.rejects(startRun(c, 'x'), (e: HttpError) => e.status === 409);
});

test('publish refuses an empty change set and any file outside the scope', async () => {
  const c = context();
  await startSession(c);
  await assert.rejects(publish(c), (e: HttpError) => e.status === 400 && /no changes/.test(e.message));
  write(site(), { 'src/components/Header.astro': 'header v2\n', 'src/admin/x.ts': 'hacked\n', 'src/pages/x.ts': '' });
  await assert.rejects(publish(c), (e: HttpError) => {
    assert.equal(e.status, 400);
    assert.deepEqual(e.details, ['src/admin/x.ts', 'src/pages/x.ts']);
    return true;
  });
  assert.equal(code.commits.length, 0);
});

test('git mode: publish is one commit of every change, based on the blobs the session started from', async () => {
  const c = context();
  await startSession(c);
  await finishedRun(c, 'Make the header say v2 and add a logo');
  write(site(), {
    'src/components/Header.astro': 'header v2\n',
    'src/components/New.astro': 'new\n',
    'public/logo.png': PNG,
    'config/site.yml': 'title: v2\n',
  });
  fs.rmSync(site('public/remove-me.txt'));

  const result = await publish(c);
  assert.deepEqual(result.commit, { id: 'c1', url: 'https://github.com/jane/site/commit/c1' });
  assert.equal(code.commits.length, 1);
  const [{ changes, message, base }] = code.commits;
  assert.equal(message, 'Site editor: Make the header say v2 and add a logo');
  const byPath = Object.fromEntries(changes.map((ch) => [ch.path, ch]));
  assert.deepEqual(Object.keys(byPath).sort(), [
    'config/site.yml',
    'public/logo.png',
    'public/remove-me.txt',
    'src/components/Header.astro',
    'src/components/New.astro',
  ]);
  assert.deepEqual(byPath['src/components/Header.astro'], {
    path: 'src/components/Header.astro',
    content: 'header v2\n',
  });
  assert.deepEqual(byPath['public/logo.png'], {
    path: 'public/logo.png',
    content: PNG.toString('base64'),
    encoding: 'base64',
  });
  assert.equal(byPath['public/remove-me.txt'].content, null);
  assert.deepEqual(base, {
    'config/site.yml': gitBlobSha('title: v1\n'),
    'public/logo.png': null,
    'public/remove-me.txt': gitBlobSha('bye\n'),
    'src/components/Header.astro': gitBlobSha('header v1\n'),
    'src/components/New.astro': null,
  });

  const after = ready(await sessionStatus(c));
  assert.deepEqual(after.files, [], 'what was published is the new base');
  assert.equal(after.run, undefined, 'and the run list starts over');
});

test('a file changed on GitHub since the session started is a 409, and nothing moves', async () => {
  const c = context();
  await startSession(c);
  write(site(), { 'src/components/Header.astro': 'header v2\n' });
  code.fail = new ConflictError('src/components/Header.astro');
  await assert.rejects(publish(c, 'msg'), (e: HttpError) => {
    assert.equal(e.status, 409);
    assert.match(
      e.message,
      /site changed since this session started \(src\/components\/Header\.astro\): use Start over/,
    );
    return true;
  });
  assert.equal(ready(await sessionStatus(c)).files.length, 1);
});

test('Postgres mode: code is committed to GitHub first, then documents to the database; a failed document save says what is live', async () => {
  const db = path.join(root, 'db');
  write(db, { 'config/site.yml': 'title: from the database\n' });
  const order: string[] = [];
  code = codeStore(order);
  const docs = new MemoryStore(db);
  const saveDocs = docs.commit.bind(docs);
  let docsFail: Error | null = null;
  docs.commit = async (...args) => {
    order.push('docs');
    if (docsFail) throw docsFail;
    return saveDocs(...args);
  };
  const c = context({ docs, code: code as unknown as ContentStore });
  await startSession(c);
  write(site(), {
    'src/components/Header.astro': 'header v2\n',
    'config/site.yml': 'title: edited\n',
    'src/content/posts/new2.md': 'a new post\n',
  });

  const result = await publish(c, 'Retitle');
  assert.deepEqual(order, ['code', 'docs']);
  assert.deepEqual(
    code.commits[0].changes.map((ch) => ch.path),
    ['src/components/Header.astro'],
  );
  assert.deepEqual(result.documents?.sort(), ['config/site.yml', 'src/content/posts/new2.md']);
  assert.equal((await docs.read('config/site.yml'))?.content, 'title: edited\n');
  assert.equal(state().docVersions['config/site.yml'], gitBlobSha('title: edited\n'));
  assert.deepEqual(ready(await sessionStatus(c)).files, []);

  write(site(), { 'src/components/Header.astro': 'header v3\n', 'config/site.yml': 'title: again\n' });
  docsFail = new UpstreamError('The database is unreachable. Try again in a moment.', 503);
  await assert.rejects(publish(c, 'Again'), (e: HttpError) => {
    assert.equal(e.status, 503);
    assert.match(
      e.message,
      /^The code is live \(https:\/\/github\.com\/jane\/site\/commit\/c2\), but the content was not saved/,
    );
    return true;
  });
  assert.deepEqual(
    ready(await sessionStatus(c)).files.map((f) => f.path),
    ['config/site.yml'],
    'the code is the new base; the content is still to publish',
  );
});

test('discard drops every change and goes back to the base, without touching the network', async () => {
  const c = context();
  await startSession(c);
  await finishedRun(c, 'something');
  write(site(), { 'src/components/Header.astro': 'header v2\n', 'src/components/Extra.astro': 'x\n' });
  fs.rmSync(site('public/remove-me.txt'));
  const base = state().baseSha;
  const policies = api.sandbox!.policies.length;

  const s = ready(await discardChanges(c));
  assert.deepEqual(s.files, []);
  assert.equal(s.run, undefined);
  assert.equal(fs.readFileSync(site('src/components/Header.astro'), 'utf8'), 'header v1\n');
  assert.ok(fs.existsSync(site('public/remove-me.txt')) && !fs.existsSync(site('src/components/Extra.astro')));
  assert.equal(state().baseSha, base);
  assert.equal(api.sandbox!.policies.length, policies, 'the network policy is untouched');
});

test('start over deletes the sandbox and clones the live branch into a new one', async () => {
  const c = context();
  await startSession(c);
  write(site(), { 'src/components/Header.astro': 'header v2\n' });
  write(work, { 'src/pages/index.astro': 'index v2 (pushed meanwhile)\n' });
  git(work, 'commit', '-q', '-am', 'upstream');
  git(work, 'push', '-q', 'origin', 'main');
  const first = api.sandbox!;

  const s = ready(await startOver(c));
  assert.equal(first.status, 'deleted');
  assert.equal(api.all.length, 2);
  assert.deepEqual(s.files, [], 'unpublished changes are gone');
  assert.equal(fs.readFileSync(site('src/pages/index.astro'), 'utf8'), 'index v2 (pushed meanwhile)\n');
  assert.equal(state().baseSha, git(work, 'rev-parse', 'HEAD').trim());
});

test('the GitHub token enters a sandbox only for its first clone, and GitHub closes before any agent runs', async () => {
  const c = context();
  await startSession(c);
  await finishedRun(c, 'first');
  await sessionStatus(c);
  write(site(), { 'src/components/Header.astro': 'header v2\n' });
  const result = await publish(c);
  await finishedRun(c, 'second');
  write(site(), { 'src/components/Header.astro': 'header v3\n' });
  await discardChanges(c);
  await endSession(c);
  await startSession(c);

  const calls = api.calls();
  const clones = calls.filter((x) => x.script === SCRIPTS.clone);
  assert.equal(clones.length, 1);
  const afterClone = calls.slice(calls.indexOf(clones[0]) + 1);
  for (const call of afterClone) {
    assert.ok(!JSON.stringify(call).includes('ghp_SECRET'), `no token in ${call.script.slice(0, 40)}`);
    assert.equal(call.env.GIT_TOKEN, undefined);
    assert.doesNotMatch(call.script, /\bfetch\b|\bpull\b|\bpush\b|\bclone\b/, 'nothing reaches GitHub');
  }
  for (const call of calls.filter((x) => !x.detached && !LocalSandbox.stubbed.has(x.script))) {
    assert.equal(call.env.GIT_CONFIG_GLOBAL, '/dev/null', 'no user git config');
    assert.equal(call.env.GIT_CONFIG_NOSYSTEM, '1', 'no system git config');
  }
  assert.equal(api.createdWith.length, 1);
  assert.ok(api.createdWith[0].allow['github.com'], 'only the new sandbox’s policy opens GitHub');
  for (const policy of api.all.flatMap((sb) => sb.policies)) assert.equal(policy.allow['github.com'], undefined);
  assert.deepEqual(state().published?.id, result.commit?.id, 'the published commit is recorded');
  assert.equal(ready(await sessionStatus(c)).published?.url, 'https://github.com/jane/site/commit/c1');
});

test('git config the agent planted does not run inside the editor’s own git commands', async () => {
  const c = context();
  await startSession(c);
  const marks = path.join(root, 'marks');
  const hooks = path.join(root, 'evil-hooks');
  fs.mkdirSync(marks);
  fs.mkdirSync(hooks);
  const evil = (name: string, file = path.join(root, `evil-${name}`)) => {
    fs.writeFileSync(file, `#!/bin/sh\ntouch "${marks}/${name}"\n`, { mode: 0o755 });
    return file;
  };
  for (const hook of ['reference-transaction', 'post-checkout', 'pre-commit', 'post-commit', 'post-index-change']) {
    evil(`hook-${hook}`, path.join(hooks, hook));
  }
  git(site(), 'config', 'core.hooksPath', hooks);
  git(site(), 'config', 'core.fsmonitor', evil('fsmonitor'));
  git(site(), 'config', 'diff.external', evil('external'));
  git(site(), 'config', 'diff.evil.textconv', evil('textconv'));
  fs.writeFileSync(site('.git/info/attributes'), '* diff=evil\n');
  write(site(), { 'src/components/Header.astro': 'header v2\n' });

  assert.match(ready(await sessionStatus(c)).diff, /\+header v2/);
  await publish(c, 'msg');
  write(site(), { 'src/components/Header.astro': 'header v3\n' });
  await discardChanges(c);
  assert.deepEqual(fs.readdirSync(marks), []);
});

test('end stops the sandbox and keeps it for the next start', async () => {
  const c = context();
  assert.deepEqual(await sessionStatus(c), { state: 'none', blocked: undefined });
  await startSession(c);
  assert.deepEqual(await endSession(c), { state: 'stopped' });
  assert.equal(api.sandbox!.status, 'stopped');
  assert.deepEqual(await sessionStatus(c), { state: 'stopped', blocked: undefined });
  ready(await startSession(c));
  assert.equal(api.sandbox!.called(SCRIPTS.clone).length, 1);
});
