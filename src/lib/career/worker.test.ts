import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { PLACEHOLDER, type CommandResult, type NetworkPolicy, type SandboxApi } from '../admin/editor';
import { PostgresStore } from '../admin/postgres-store';
import { getSecret, setSecret } from '../admin/secrets';
import { parsePrefs, type CareerPrefs } from './settings';
import { QuotaError, setWorkerSandboxForTests, workerText } from './worker';

const INPUT = { system: 'You draft.', prompt: 'Write it.', maxTokens: 100 };
const TOKEN = 'sk-ant-oat01-real-subscription-token';
const AUTH = JSON.stringify({
  tokens: { access_token: 'codex-access-0123456789', refresh_token: 'codex-refresh-0123456789' },
});
const REFRESHED = JSON.stringify({
  tokens: { access_token: 'codex-access-NEW-456789', refresh_token: 'codex-refresh-NEW-6789' },
});

const saved = { ...process.env };
let sql: Sql;
let store: PostgresStore;
let apiCalls: number;

interface Fake {
  api: SandboxApi;
  written: Map<string, string>;
  /** Every file written, as `path=content`. */
  log: string[];
  runs: { script: string; args: string[]; env?: Record<string, string> }[];
  policies: NetworkPolicy[];
  stops: number;
}

/** A worker VM whose CLI answers with `reply`; `files` are what the CLI leaves behind (last.txt, a refreshed auth.json). */
function fakeVm(reply: CommandResult, files: Record<string, string> = {}): Fake {
  const fake: Fake = { api: null as never, written: new Map(), log: [], runs: [], policies: [], stops: 0 };
  const handle = {
    status: 'running',
    async run(script: string, args: string[] = [], opts: { env?: Record<string, string> } = {}) {
      fake.runs.push({ script, args, env: opts.env });
      if (/claude -p|codex exec|gemini --skip-trust/.test(script)) {
        for (const [name, content] of Object.entries(files)) fake.written.set(`${args[0]}/${name}`, content);
        return reply;
      }
      if (script.includes('rm -rf "$1"')) {
        for (const path of [...fake.written.keys()]) if (path.startsWith(args[0])) fake.written.delete(path);
        return { exitCode: 0, stdout: 'idle\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    spawn: async () => {},
    readFile: async (path: string) => (fake.written.has(path) ? Buffer.from(fake.written.get(path)!) : null),
    writeFiles: async (files: { path: string; content: Buffer }[]) =>
      files.forEach((f) => {
        fake.written.set(f.path, f.content.toString());
        fake.log.push(`${f.path}=${f.content.toString()}`);
      }),
    domain: () => '',
    setNetworkPolicy: async (p: NetworkPolicy) => void fake.policies.push(p),
    extendTimeout: async () => {},
    stop: async () => void fake.stops++,
    delete: async () => {},
    setTags: async () => {},
  };
  fake.api = { get: async () => handle, create: async () => handle };
  return fake;
}

const cli = (agent: 'claude' | 'codex' | 'gemini', auth: 'key' | 'subscription'): CareerPrefs =>
  parsePrefs({ worker: { kind: 'cli', agent, auth } });
const claudeJson = (result: string, isError = false): CommandResult => ({
  exitCode: isError ? 1 : 0,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: isError, result }),
  stderr: '',
});

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  store = new PostgresStore(sql, { name: 't', email: 't@t' });
  process.env.SESSION_SECRET = 'a'.repeat(32);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  apiCalls = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    if (!String(input).startsWith('https://api.anthropic.com/')) return new Response('missing', { status: 404 });
    apiCalls++;
    return Response.json({ content: [{ type: 'text', text: 'from the API' }] });
  });
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  setWorkerSandboxForTests(null);
  process.env = { ...saved };
});

test('api worker calls generateText', async () => {
  const vm = fakeVm(claudeJson('never'));
  setWorkerSandboxForTests(vm.api);
  assert.equal(await workerText(store, parsePrefs({}), INPUT), 'from the API');
  assert.equal(apiCalls, 1);
  assert.equal(vm.runs.length, 0, 'no sandbox for the API worker');
});

test('claude subscription keeps the token out of the VM env', async () => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
  const vm = fakeVm(claudeJson('the plan'));
  setWorkerSandboxForTests(vm.api);

  assert.equal(await workerText(store, cli('claude', 'subscription'), INPUT), 'the plan');

  const run = vm.runs.find((r) => r.script.includes('claude -p'))!;
  assert.match(run.script, /--output-format json/);
  assert.match(run.script, /--tools ""/);
  assert.equal(run.env?.CLAUDE_CODE_OAUTH_TOKEN, PLACEHOLDER);
  assert.equal(run.env?.ANTHROPIC_API_KEY, undefined);
  for (const r of vm.runs) assert.ok(!JSON.stringify(r).includes(TOKEN), 'the token is in no command or env');
  const policy = vm.policies.at(-1)!;
  assert.deepEqual(policy.allow['api.anthropic.com'], [
    { transform: [{ headers: { authorization: `Bearer ${TOKEN}` } }] },
  ]);
  assert.equal(apiCalls, 0);
  assert.equal(vm.written.size, 0, 'the call’s files are removed afterwards');
});

test('claude with an API key brokers the editor’s x-api-key header', async () => {
  const vm = fakeVm(claudeJson('ok'));
  setWorkerSandboxForTests(vm.api);
  await workerText(store, cli('claude', 'key'), INPUT);
  const run = vm.runs.find((r) => r.script.includes('claude -p'))!;
  assert.equal(run.env?.ANTHROPIC_API_KEY, PLACEHOLDER);
  assert.deepEqual(vm.policies.at(-1)!.allow['api.anthropic.com'], [
    { transform: [{ headers: { 'x-api-key': 'test-key' } }] },
  ]);
});

test('codex subscription writes auth.json and re-seals a refreshed one', async () => {
  await setSecret(sql, 'CODEX_AUTH_JSON', AUTH, 'owner');
  const vm = fakeVm(
    { exitCode: 0, stdout: '', stderr: '' },
    { 'last.txt': 'the letter', 'codex/auth.json': REFRESHED },
  );
  setWorkerSandboxForTests(vm.api);

  assert.equal(await workerText(store, cli('codex', 'subscription'), INPUT), 'the letter');

  assert.ok(
    vm.log.some((s) => s.endsWith(`/codex/auth.json=${AUTH}`)),
    'auth.json goes in for this run',
  );
  const run = vm.runs.find((r) => r.script.includes('codex exec'))!;
  assert.match(run.script, /--skip-git-repo-check/);
  assert.match(run.script, /-o last\.txt/);
  assert.equal(await getSecret(sql, 'CODEX_AUTH_JSON'), REFRESHED, 're-sealed');
  assert.ok(![...vm.written.keys()].some((p) => p.endsWith('auth.json')), 'auth.json is deleted from the VM');
  const hosts = Object.keys(vm.policies.at(-1)!.allow);
  for (const h of ['api.openai.com', 'chatgpt.com', 'auth.openai.com']) assert.ok(hosts.includes(h), h);
  assert.ok(!JSON.stringify(vm.policies).includes('codex-access'), 'the sign-in is not in the policy');
});

test('a reply that carries the Codex sign-in is refused', async () => {
  await setSecret(sql, 'CODEX_AUTH_JSON', AUTH, 'owner');
  const vm = fakeVm({ exitCode: 0, stdout: '', stderr: '' }, { 'last.txt': 'token: codex-refresh-0123456789' });
  setWorkerSandboxForTests(vm.api);
  await assert.rejects(workerText(store, cli('codex', 'subscription'), INPUT), /sign-in/);
});

test('quota text raises QuotaError', async () => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
  setWorkerSandboxForTests(fakeVm(claudeJson('Claude AI usage limit reached|1792771200', true)).api);
  await assert.rejects(workerText(store, cli('claude', 'subscription'), INPUT), (e: Error) => {
    assert.ok(e instanceof QuotaError);
    assert.match(e.message, /^Your Claude subscription is out of quota until .*2026/);
    return true;
  });
  setWorkerSandboxForTests(
    fakeVm({ exitCode: 1, stdout: '', stderr: "ERROR: You've hit your usage limit. Try again at 3:45 PM." }).api,
  );
  await setSecret(sql, 'CODEX_AUTH_JSON', AUTH, 'owner');
  await assert.rejects(workerText(store, cli('codex', 'subscription'), INPUT), (e: Error) => {
    assert.ok(e instanceof QuotaError);
    assert.match(e.message, /hit your usage limit/);
    return true;
  });
});

test('a CLI failure that is not quota is a plain error; a successful answer mentioning a quota is not', async () => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
  setWorkerSandboxForTests(fakeVm({ exitCode: 1, stdout: '', stderr: 'boom' }).api);
  await assert.rejects(workerText(store, cli('claude', 'subscription'), INPUT), (e: Error) => {
    assert.ok(!(e instanceof QuotaError));
    assert.match(e.message, /Claude Code failed: boom/);
    return true;
  });
  setWorkerSandboxForTests(fakeVm(claudeJson('I raised the team’s rate limit.')).api);
  assert.equal(await workerText(store, cli('claude', 'subscription'), INPUT), 'I raised the team’s rate limit.');
});

test('a QuotaError never falls back to the API', async () => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
  setWorkerSandboxForTests(fakeVm(claudeJson('You have reached your usage limit', true)).api);
  await assert.rejects(workerText(store, cli('claude', 'subscription'), INPUT), QuotaError);
  setWorkerSandboxForTests(fakeVm({ exitCode: 1, stdout: '', stderr: 'boom' }).api);
  await assert.rejects(workerText(store, cli('claude', 'subscription'), INPUT));
  assert.equal(apiCalls, 0, 'generateText is never called for a CLI worker');
});

test('gemini runs on the Gemini API key in either auth mode', async () => {
  process.env.GEMINI_API_KEY = 'g-key';
  const vm = fakeVm({ exitCode: 0, stdout: JSON.stringify({ response: 'gem' }), stderr: '' });
  setWorkerSandboxForTests(vm.api);
  assert.equal(await workerText(store, cli('gemini', 'subscription'), INPUT), 'gem');
  const run = vm.runs.find((r) => r.script.includes('gemini --skip-trust'))!;
  assert.equal(run.env?.GEMINI_API_KEY, PLACEHOLDER);
  assert.deepEqual(vm.policies.at(-1)!.allow['generativelanguage.googleapis.com'], [
    { transform: [{ headers: { 'x-goog-api-key': 'g-key' } }] },
  ]);
});

/**
 * The setup script the worker sends before its CLI runs, run here in bash against a stub CLI printing `version` (none:
 * not installed) and a stub npm that logs its arguments. Returns what npm was asked and whether --version was asked.
 */
async function install(agent: 'claude' | 'codex' | 'gemini', version: string | null, home?: string) {
  process.env.OPENAI_API_KEY = 'o-key';
  process.env.GEMINI_API_KEY = 'g-key';
  const vm = fakeVm(claudeJson('ok'), { 'last.txt': 'ok' });
  setWorkerSandboxForTests(vm.api);
  await workerText(store, cli(agent, 'key'), INPUT).catch(() => {});
  const script = vm.runs[0].script;
  const dir = home ?? mkdtempSync(join(tmpdir(), 'worker-install-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  rmSync(join(dir, 'log'), { force: true });
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('npm', `echo "npm $*" >> "${dir}/log"`);
  if (version) stub(agent, `echo "${agent} $*" >> "${dir}/log"; echo "${version}"`);
  else rmSync(join(bin, agent), { force: true });
  execFileSync('bash', ['-c', script], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const log = existsSync(join(dir, 'log')) ? readFileSync(join(dir, 'log'), 'utf8').trim().split('\n') : [];
  return { npm: log.filter((l) => l.startsWith('npm ')), asked: log.some((l) => l === `${agent} --version`), dir };
}

test('a CLI older than the flags it is run with is replaced by the pinned version', async () => {
  const cases = [
    ['claude', '2.1.283 (Claude Code)', 'npm i -g @anthropic-ai/claude-code@2.1.305'],
    ['codex', 'codex-cli 0.158.0', 'npm i -g @openai/codex@0.163.0'],
    ['gemini', '0.63.0', 'npm i -g @google/gemini-cli@0.65.0'],
    ['claude', null, 'npm i -g @anthropic-ai/claude-code@2.1.305'],
  ] as const;
  for (const [agent, version, expected] of cases) {
    const { npm, dir } = await install(agent, version);
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(npm, [expected], `${agent} ${version}`);
  }
});

test('a new enough CLI is kept, and the marker skips the check next time', async () => {
  for (const [agent, version] of [
    ['claude', '2.1.305 (Claude Code)'],
    ['codex', 'codex-cli 0.170.2'],
    ['gemini', '0.65.0'],
  ] as const) {
    const first = await install(agent, version);
    assert.deepEqual(first.npm, [], `${agent} ${version}`);
    assert.ok(first.asked, 'the version was checked');
    const again = await install(agent, version, first.dir);
    assert.deepEqual([again.npm, again.asked], [[], false], `${agent}: the marker answers`);
    rmSync(first.dir, { recursive: true, force: true });
  }
});

/**
 * Runs the call's first script (the sweep and install) against a local copy of the worker root holding two other
 * calls' Codex sign-ins: one written 6 minutes ago (its call is over) and one just now (its call may still run).
 */
async function sweep(prefs: CareerPrefs) {
  await setSecret(sql, 'CODEX_AUTH_JSON', AUTH, 'owner');
  process.env.OPENAI_API_KEY = 'o-key';
  const vm = fakeVm(claudeJson('ok'), { 'last.txt': 'ok' });
  setWorkerSandboxForTests(vm.api);
  await workerText(store, prefs, INPUT).catch(() => {});
  const home = mkdtempSync(join(tmpdir(), 'worker-sweep-'));
  const root = join(home, 'worker');
  const auth = (call: string) => join(root, call, 'codex', 'auth.json');
  for (const call of ['old', 'live']) {
    execFileSync('mkdir', ['-p', join(root, call, 'codex')]);
    writeFileSync(auth(call), AUTH);
  }
  const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
  utimesSync(auth('old'), sixMinutesAgo, sixMinutesAgo);
  const bin = join(home, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(bin, name), '#!/bin/sh\necho 99.0.0\n');
    chmodSync(join(bin, name), 0o755);
  }
  execFileSync('bash', ['-c', vm.runs[0].script.replaceAll('/vercel/sandbox/worker', root)], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const left = { old: existsSync(auth('old')), live: existsSync(auth('live')) };
  rmSync(home, { recursive: true, force: true });
  return left;
}

test('each Codex call first deletes the sign-ins other calls left behind, not a live call’s', async () => {
  assert.deepEqual(await sweep(cli('codex', 'subscription')), { old: false, live: true });
});

test('a worker that doesn’t sign in to Codex deletes every Codex sign-in in the VM', async () => {
  assert.deepEqual(await sweep(cli('claude', 'key')), { old: false, live: false });
  assert.deepEqual(await sweep(cli('codex', 'key')), { old: false, live: false });
});

test('a missing sign-in names the key', async () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  setWorkerSandboxForTests(fakeVm(claudeJson('x')).api);
  await assert.rejects(workerText(store, cli('claude', 'subscription'), INPUT), /CLAUDE_CODE_OAUTH_TOKEN is not set/);
});
