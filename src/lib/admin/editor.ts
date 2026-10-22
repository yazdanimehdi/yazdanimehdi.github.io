import { randomUUID } from 'node:crypto';
import { TEXT_PROVIDERS, type TextProviderId } from '../ai/providers';
import { getMode } from '../mode';
import { readAiConfig } from './ai';
import { defaultCommitMessage } from './editor-message';
import { inEditorScope } from './editor-scope';
import { GitHubStore, githubConfig, type GitHubConfig } from './github-store';
import { HttpError, authorOf, commitChanges } from './http';
import { assertAllowed, isDocumentPath } from './paths';
import { PostgresStore } from './postgres-store';
import { vercelSandbox } from './sandbox';
import { getSecret, missingKey, secretsDb } from './secrets';
import type { SessionUser } from './session';
import { adminSettings, canPublish } from './settings';
import { ConflictError, UpstreamError, type Change, type CommitResult, type ContentStore } from './store';

const SITE_DIR = '/vercel/site';
const EDITOR_DIR = '/vercel/editor';
const STATE_PATH = `${EDITOR_DIR}/state.json`;
/** Where the agent writes its plain-language summary: outside the checkout, so it can never be published. */
const SUMMARY_PATH = `${EDITOR_DIR}/summary.md`;
const MAX_SUMMARY = 1500;
/** Ends every publish commit's message: how Undo this publish tells an editor publish from any other commit. */
export const EDITOR_TRAILER = 'Site-editor: publish';
const PORT = 4321;
const SESSION_TIMEOUT = 30 * 60_000;
const MAX_PROMPT = 20_000;
const MAX_DIFF = 200_000;
const MAX_LOG = 100_000;
/** The agent can write anything into these files, so they are read capped. */
const MAX_STATE = 1_000_000;
const MAX_SUMMARY_FILE = 8192;
/** Postgres mode keeps every document (isDocumentPath) under these folders. */
const DOC_DIRS = ['config', 'src/content', 'src/data'];
/** The CLI must see a key to start; the sandbox firewall replaces the header carrying it with the real one. */
const PLACEHOLDER = 'brokered-by-the-sandbox-firewall';

/** The session's only store: a file in the sandbox, so it works in git and Postgres mode alike. */
export interface EditorSession {
  /** Local commit the working tree is compared with: the clone, then each publish or document export on top. */
  baseSha: string;
  /** Postgres mode: document path → version exported into the sandbox. */
  docVersions: Record<string, string>;
  provider: TextProviderId;
  model: string;
  runs: EditorRun[];
  /**
   * The last GitHub commit this session published, for the screen. `undoable`: a publish of code alone, which Undo
   * this publish covers; false for an undo itself and for a publish that also saved documents. Older sessions lack it.
   */
  published?: { id: string; url?: string; at: string; undoable?: boolean };
}

export interface EditorRun {
  id: string;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  /** Missing on a finished run: it ended without one (the session stopped under it). */
  exitCode?: number;
  /** Who asked: the session's login, and its display name (runs from before it was recorded have none). */
  by: string;
  byName?: string;
  /** The agent's own plain-language account of what it changed, when it gave one. */
  summary?: string;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  binary: boolean;
  /** Inside the editor's scope (editor-scope.ts); one refused file blocks Publish. */
  allowed: boolean;
  /** Postgres mode: Publish saves it to the database, so Undo this publish won't cover that publish. */
  document?: boolean;
}

export type EditorStatus =
  | { state: 'unavailable'; reason: string }
  | { state: 'none' | 'stopped'; blocked?: string }
  | {
      state: 'ready';
      blocked?: string;
      previewUrl: string;
      provider: TextProviderId;
      model: string;
      run?: EditorRun & { running: boolean };
      /** Every request since the last publish or discard, oldest first: what Publish would ship. */
      requests: { prompt: string; summary?: string; by: string; byName?: string }[];
      published?: EditorSession['published'];
      log: string;
      files: ChangedFile[];
      diff: string;
      diffTruncated: boolean;
    };

export interface NetworkPolicy {
  allow: Record<string, { transform: { headers: Record<string, string> }[] }[]>;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** One sandbox, as the editor uses it; src/lib/admin/sandbox.ts adapts the Vercel SDK, tests pass fakes. */
export interface SandboxHandle {
  /** 'running' while a session is up; anything else means stopped (a call would resume it). */
  readonly status: string;
  /** `bash -lc script bash ...args`: values reach the script as $1…, never spliced into its text. */
  run(
    script: string,
    args?: string[],
    opts?: { env?: Record<string, string>; timeoutMs?: number },
  ): Promise<CommandResult>;
  /** Like run, but returns once started. */
  spawn(script: string, args?: string[], env?: Record<string, string>): Promise<void>;
  readFile(path: string): Promise<Buffer | null>;
  writeFiles(files: { path: string; content: Buffer }[]): Promise<void>;
  domain(port: number): string;
  setNetworkPolicy(policy: NetworkPolicy): Promise<void>;
  extendTimeout(ms: number): Promise<void>;
  stop(): Promise<void>;
  /** Stops it and deletes it with its files and snapshots. */
  delete(): Promise<void>;
  /** Platform metadata, readable without waking a stopped sandbox; the agent inside can't change it. */
  readonly tags?: Record<string, string>;
  setTags(tags: Record<string, string>): Promise<void>;
}

export interface SandboxApi {
  /** null when it was never created. A stopped sandbox stays stopped unless `resume`. */
  get(name: string, opts?: { resume?: boolean }): Promise<SandboxHandle | null>;
  /** A new persistent sandbox with `ports` exposed. */
  create(
    name: string,
    opts: { networkPolicy: NetworkPolicy; timeoutMs: number; ports: number[] },
  ): Promise<SandboxHandle>;
}

interface Agent {
  /** argv of the provider's coding CLI; `resume` continues the session's conversation. */
  cli: (model: string, prompt: string, resume: boolean) => string[];
  domain: string;
  header: (key: string) => Record<string, string>;
  env: Record<string, string>;
  /** Shell that installs the CLI when the sandbox image lacks it; idempotent. */
  install?: string;
}

/** Flags checked with --help in a sandbox (Claude Code 2.1.283, codex-cli 0.158.0, Gemini CLI 0.63.0). */
export const AGENTS: Record<TextProviderId, Agent> = {
  anthropic: {
    cli: (model, prompt, resume) => [
      'claude',
      '-p',
      prompt,
      '--model',
      model,
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
      ...(resume ? ['--continue'] : []),
    ],
    domain: 'api.anthropic.com',
    header: (key) => ({ 'x-api-key': key }),
    env: { ANTHROPIC_API_KEY: PLACEHOLDER, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  },
  openai: {
    // codex 0.158 has no --full-auto; the sandbox is the isolation its own sandbox would add.
    cli: (model, prompt, resume) => [
      'codex',
      'exec',
      ...(resume ? ['resume', '--last'] : []),
      '--dangerously-bypass-approvals-and-sandbox',
      '-m',
      model,
      prompt,
    ],
    domain: 'api.openai.com',
    header: (key) => ({ authorization: `Bearer ${key}` }),
    env: { OPENAI_API_KEY: PLACEHOLDER, CODEX_API_KEY: PLACEHOLDER },
  },
  google: {
    cli: (model, prompt, resume) => [
      'gemini',
      '-p',
      prompt,
      '-m',
      model,
      '--yolo',
      '--skip-trust',
      ...(resume ? ['--resume', 'latest'] : []),
    ],
    domain: 'generativelanguage.googleapis.com',
    header: (key) => ({ 'x-goog-api-key': key }),
    env: { GEMINI_API_KEY: PLACEHOLDER },
    install: 'command -v gemini >/dev/null || npm i -g @google/gemini-cli >/dev/null 2>&1',
  },
};

// Every prompt starts with this text, so a request beginning with "-" can't be read as a CLI flag.
const PREAMBLE = `You are editing the source of an Astro website in the current directory. A person will review your changes in a live preview before publishing them.
Rules:
- Change only site code and content: src/components, src/layouts, src/pages, src/styles, src/themes, src/assets, src/content, src/data/*.json, public, config/*.yml.
- In src/pages create or edit only .astro, .md and .mdx files: never a .ts or .js file there, never an endpoint or API route, nothing named api. In src/content only .md, .mdx, .json and .yml files, never the collection config.
- Never add .mjs, .cjs, .mts or .cts files, middleware, or files named like an endpoint (such as feed.xml.ts).
- Never read process.env or import.meta.env in pages or components: the site's secrets must not reach a page.
- Never touch the admin (src/admin), src/lib, integrations, config/ai.yml, package.json, the lockfile, build or deploy config, dot-files or secrets. Do not install dependencies. Do not commit.
- Keep both the light and the dark theme working and text contrast at WCAG AA.
- Run \`pnpm astro check\` before you finish and fix what it reports.
- When you finish, write two or three plain sentences for the site's owner, who is not a developer, saying what you changed and where it shows on the site. No headings, no code, file names only when they help. Save them to ${SUMMARY_PATH} (outside the site folder) and end your reply with the same sentences.

The request:
`;

/**
 * Every git call after the clone: the agent has had write access to .git, so config it may have planted (hooks,
 * fsmonitor, external diff, textconv) must not run inside our own commands. Clean and smudge filters still could;
 * that is the agent running code in its own VM, which never holds a secret after the clone.
 */
const GIT = 'git() { command git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c diff.external= "$@"; }';
const DIFF = 'diff --no-ext-diff --no-textconv --cached --no-renames';

// Shell scripts are constants; everything variable arrives as an argument or an environment variable.
// Exported for tests, which run them with a local bash and stub the ones that need npm or a dev server.
export const SCRIPTS = {
  /** The only script that ever sees GITHUB_TOKEN, in a sandbox just created, before any agent has run in it. */
  clone: `set -e
rm -rf "$SITE"; mkdir -p "$EDITOR/runs"
git clone -q --depth 1 --branch "$2" "$1" "$SITE"
cd "$SITE"
git config user.name 'Site editor'; git config user.email 'site-editor@localhost'
printf '.claude/\\n.codex/\\n.gemini/\\n' >> .git/info/exclude
git rev-parse HEAD`,
  install: `set -e
cd "$SITE"
v=$(node -p "(require('./package.json').packageManager || '').match(/^pnpm@([0-9][^+]*)/)?.[1] || '10'")
npm i -g "pnpm@$v" >/dev/null 2>&1
pnpm install --frozen-lockfile > "$EDITOR/install.log" 2>&1 || { tail -20 "$EDITOR/install.log" >&2; exit 1; }`,
  /** Restarts `astro dev` on PORT; the old server must free the port first or Vite moves to the next one. */
  dev: `pid=$(cat "$EDITOR/dev.pid" 2>/dev/null)
grep -qs astro "/proc/$pid/cmdline" && kill "$pid"
for i in $(seq 50); do curl -s -o /dev/null "http://localhost:$1/" || break; sleep 0.2; done
echo $$ > "$EDITOR/dev.pid"
cd "$SITE"
exec ./node_modules/.bin/astro dev --host 0.0.0.0 --port "$1" --allowed-hosts > "$EDITOR/dev.log" 2>&1`,
  waitDev: `for i in $(seq 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$1/")" = 200 ] && exit 0
  sleep 1
done
tail -20 "$EDITOR/dev.log" >&2; exit 1`,
  /**
   * $1 run id, then the CLI's argv. The pid and exit files tell a running run from a finished or lost one. Job
   * control puts the CLI in its own process group (.pgid), so Stop reaches whatever it started too.
   */
  run: `d="$EDITOR/runs"; id=$1; shift
echo $$ > "$d/$id.pid"
rm -f "$EDITOR/summary.md"
cd "$SITE"
set -m
"$@" > "$d/$id.log" 2>&1 < /dev/null &
echo $! > "$d/$id.pgid"
wait $!
s=$?
mv -f "$EDITOR/summary.md" "$d/$id.summary" 2>/dev/null
echo $s > "$d/$id.exit"`,
  /** $1 run id: the wrapper first, so it never records an exit code, then the CLI's whole process group. */
  stop: `d="$EDITOR/runs"
kill -TERM "$(cat "$d/$1.pid" 2>/dev/null)" 2>/dev/null
g=$(cat "$d/$1.pgid" 2>/dev/null)
if [ -n "$g" ]; then kill -TERM -- "-$g" 2>/dev/null; sleep 1; kill -KILL -- "-$g" 2>/dev/null; fi
exit 0`,
  runState: `d="$EDITOR/runs"
if [ -f "$d/$1.exit" ]; then cat "$d/$1.exit"; elif kill -0 "$(cat "$d/$1.pid" 2>/dev/null)" 2>/dev/null; then echo running; else echo lost; fi`,
  /**
   * $1 base, $2 section separator, $3 latest run id. A private index keeps the agent's own index untouched; it is
   * seeded from the base because `add -A` never adds a tracked file that .gitignore matches.
   */
  status: `${GIT}
cd "$SITE"
export GIT_INDEX_FILE="$EDITOR/status.index"
[ -f "$GIT_INDEX_FILE" ] || git read-tree "$1"
git add -A
git ${DIFF} --name-status -z "$1"; printf '%s' "$2"
git ${DIFF} --numstat -z "$1"; printf '%s' "$2"
git ${DIFF} "$1" | head -c ${MAX_DIFF + 1}; printf '%s' "$2"
if [ -n "$3" ]; then tail -n 200 "$EDITOR/runs/$3.log" 2>/dev/null | tail -c ${MAX_LOG}; fi`,
  /** $1 base, $2 message, then paths: a local commit of base plus the working tree's state of those paths. */
  advance: `set -e
${GIT}
cd "$SITE"
export GIT_INDEX_FILE="$EDITOR/advance.index"
base=$1; msg=$2; shift 2
git read-tree "$base"
git --literal-pathspecs add -A -- "$@"
sha=$(git commit-tree "$(git write-tree)" -p "$base" -m "$msg")
git update-ref refs/editor/base "$sha"
echo "$sha"`,
  /** $1 base, then paths: each one's blob sha at base, or an empty line when it didn't exist. */
  blobs: `${GIT}
cd "$SITE"; base=$1; shift
for p in "$@"; do git rev-parse -q --verify "$base:$p" || echo; done`,
  /** $1 base, then folders: tracked files under them. */
  tracked: `${GIT}
cd "$SITE"; base=$1; shift
git ls-tree -r -z --name-only "$base" -- "$@"`,
  remove: `cd "$SITE"; rm -f -- "$@"`,
  /** $1 base, then paths: each back to its state at base, or removed when base didn't have it. */
  revert: `set -e
${GIT}
cd "$SITE"; base=$1; shift
for p in "$@"; do
  if git cat-file -e "$base:$p" 2>/dev/null; then git --literal-pathspecs checkout -q "$base" -- "$p"; else rm -f -- "$p"; fi
done`,
  /** $1 base: the working tree back to it; ignored files (node_modules, .astro) stay. */
  discard: `set -e
${GIT}
cd "$SITE"
git reset -q --hard "$1"
git clean -qfd`,
  /** Empty when it doesn't exist; an oversize one arrives cut off, so it fails to parse like any corrupt one. */
  state: `head -c ${MAX_STATE} "$EDITOR/state.json" 2>/dev/null; exit 0`,
  /** $1 run id. */
  summary: `head -c ${MAX_SUMMARY_FILE} "$EDITOR/runs/$1.summary" 2>/dev/null; exit 0`,
  /** $1 run id. */
  logTail: `tail -c ${MAX_LOG} "$EDITOR/runs/$1.log" 2>/dev/null; exit 0`,
};

// No system or user git config either: only the repository's, under the overrides in GIT.
const SCRIPT_ENV = { SITE: SITE_DIR, EDITOR: EDITOR_DIR, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

async function sh(
  sb: SandboxHandle,
  script: string,
  args: string[] = [],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  const r = await sb.run(script, args, { ...opts, env: { ...SCRIPT_ENV, ...opts.env } });
  if (r.exitCode !== 0) {
    const why = r.stderr.trim().split('\n').slice(-5).join('\n') || `exit code ${r.exitCode}`;
    throw new UpstreamError(`Vercel Sandbox: a command failed: ${why}`);
  }
  return r.stdout;
}

let testSandbox: SandboxApi | null = null;

/** Tests swap the Vercel SDK adapter; production code never calls this. */
export function setSandboxForTests(api: SandboxApi | null): void {
  testSandbox = api;
}

/** One sandbox per site: `site-editor-<owner>-<repo>`. */
export const sandboxName = ({ owner, repo }: Pick<GitHubConfig, 'owner' | 'repo'>) =>
  `site-editor-${owner}-${repo}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 63);

export interface EditorTarget {
  api: SandboxApi;
  name: string;
  github: GitHubConfig;
}

/** The site's sandbox: needs the admin on Vercel and a GitHub repository with a token. */
export function editorTarget(): EditorTarget {
  if (getMode() === 'static') {
    throw new HttpError(
      404,
      'The site editor runs with the admin on Vercel (git or Postgres mode), not in a static build',
    );
  }
  let github: GitHubConfig;
  try {
    github = githubConfig(process.env);
  } catch (e) {
    if (e instanceof UpstreamError) throw new HttpError(400, e.message);
    throw e;
  }
  return { api: testSandbox ?? vercelSandbox, name: sandboxName(github), github };
}

export interface EditorContext extends EditorTarget {
  agent: { provider: TextProviderId; model: string; key: string };
  /** Where code is committed: the GitHub store (in git mode it holds the documents too). */
  code: ContentStore;
  /** Postgres mode: the database documents are exported from and published to. */
  docs: ContentStore | null;
  by: string;
  byName: string;
}

/** Everything Start and Run need; a missing provider key is a 400 naming it. */
export async function editorContext(store: ContentStore, user: SessionUser): Promise<EditorContext> {
  const target = editorTarget();
  const { provider, model } = (await readAiConfig(store)).text;
  const keyName = TEXT_PROVIDERS[provider].keys[0];
  const key = await getSecret(secretsDb(store), keyName);
  if (!key) throw missingKey(keyName);
  const postgres = store instanceof PostgresStore;
  return {
    ...target,
    agent: { provider, model, key },
    code: postgres ? new GitHubStore(target.github, authorOf(user)) : store,
    docs: postgres ? store : null,
    by: user.login,
    byName: user.name || user.login,
  };
}

/** Publish and Undo this publish; every other editor action is shared by all admins, who share one session. */
export function assertPublisher(user: SessionUser): void {
  if (!canPublish(user, adminSettings())) {
    throw new HttpError(403, 'Only the site’s publishers can publish. Your changes are saved for them to review.');
  }
}

/**
 * The real key lives only here, in the firewall's header transform; the VM sees PLACEHOLDER. GitHub is reachable
 * only while a new sandbox clones, before any agent has run in it.
 */
export function networkPolicy(agent: EditorContext['agent'], withGitHub = false): NetworkPolicy {
  const a = AGENTS[agent.provider];
  return {
    allow: {
      [a.domain]: [{ transform: [{ headers: a.header(agent.key) }] }],
      'registry.npmjs.org': [],
      '*.npmjs.org': [],
      ...(withGitHub ? { 'github.com': [], 'codeload.github.com': [] } : {}),
    },
  };
}

/**
 * The token reaches git through its environment only (never a URL, argv or .git/config), and through a credential
 * helper, so git hands it to GitHub only when GitHub asks for it.
 */
const gitAuth = (token: string) => ({
  GIT_TOKEN: token,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: '!f() { echo username=x-access-token; echo "password=$GIT_TOKEN"; }; f',
});

async function readState(sb: SandboxHandle): Promise<EditorSession | null> {
  const raw = await sh(sb, SCRIPTS.state);
  return raw ? (JSON.parse(raw) as EditorSession) : null;
}

const writeState = (sb: SandboxHandle, state: EditorSession) =>
  sb.writeFiles([{ path: STATE_PATH, content: Buffer.from(JSON.stringify(state, null, 2)) }]);

/** The sandbox tag naming who asked for the unpublished requests: the Dashboard's "waiting for review". */
const REVIEW_TAG = 'review';

/** Sets REVIEW_TAG from the session's requests; a failure only leaves the Dashboard behind, so it never fails a run. */
async function tagReview(sb: SandboxHandle, state: EditorSession): Promise<void> {
  // ponytail: tag value limits aren't documented; the first five names, URI-encoded, stay short and plain.
  const names = [...new Set(state.runs.map((r) => r.byName || r.by))].slice(0, 5);
  await sb
    .setTags(names.length ? { [REVIEW_TAG]: names.map(encodeURIComponent).join(',') } : {})
    .catch(() => undefined);
}

/**
 * The Dashboard's Next up: who asked for changes not yet published, from the sandbox's tag, so one lookup that never
 * wakes the sandbox. Empty when the editor can't run here or the lookup fails.
 */
export async function waitingForReview(): Promise<string[]> {
  try {
    const target = editorTarget();
    const raw = (await target.api.get(target.name))?.tags?.[REVIEW_TAG];
    return raw ? raw.split(',').map(decodeURIComponent) : [];
  } catch {
    return [];
  }
}

/** A running sandbox with its state, or a 409 telling the admin to start one. */
async function openSession(target: EditorTarget): Promise<{ sb: SandboxHandle; state: EditorSession }> {
  const sb = await target.api.get(target.name);
  const state = sb?.status === 'running' ? await readState(sb) : null;
  if (!sb || !state) throw new HttpError(409, 'No session is running: start one first');
  return { sb, state };
}

async function restartDevServer(sb: SandboxHandle): Promise<void> {
  await sb.spawn(SCRIPTS.dev, [String(PORT)], SCRIPT_ENV);
  await sh(sb, SCRIPTS.waitDev, [String(PORT)], { timeoutMs: 120_000 });
}

/** Commits base plus the working tree's state of `paths` inside the sandbox; returns the new base. */
async function advance(sb: SandboxHandle, base: string, message: string, paths: string[]): Promise<string> {
  return (await sh(sb, SCRIPTS.advance, [base, message, ...paths])).trim();
}

/**
 * Postgres mode: writes every database document into the checkout (deleting tracked ones the database no longer
 * has) and commits them on top of `base`, so the preview shows live content and only the agent's edits show as changes.
 */
async function exportDocuments(
  sb: SandboxHandle,
  docs: ContentStore,
  base: string,
): Promise<{ baseSha: string; docVersions: Record<string, string> }> {
  const listed = (await Promise.all(DOC_DIRS.map((d) => docs.list(d)))).flat().filter((f) => isDocumentPath(f.path));
  const files = (await Promise.all(listed.map((f) => docs.read(f.path)))).filter((f) => f !== null);
  const inDb = new Set(files.map((f) => f.path));
  const tracked = (await sh(sb, SCRIPTS.tracked, [base, ...DOC_DIRS])).split('\0').filter(Boolean);
  const stale = tracked.filter((p) => isDocumentPath(p) && !inDb.has(p));
  if (files.length) {
    await sb.writeFiles(files.map((f) => ({ path: `${SITE_DIR}/${f.path}`, content: Buffer.from(f.content) })));
  }
  if (stale.length) await sh(sb, SCRIPTS.remove, stale);
  const paths = [...inDb, ...stale];
  return {
    baseSha: paths.length ? await advance(sb, base, 'Export documents', paths) : base,
    docVersions: Object.fromEntries(files.map((f) => [f.path, f.version])),
  };
}

/**
 * Start: resumes the site's sandbox, or creates it on first use (clone, install, export); restarts the preview. The
 * GitHub token enters a VM only here, for the clone of a sandbox created moments ago.
 */
export async function startSession(ctx: EditorContext): Promise<EditorStatus> {
  let sb = await ctx.api.get(ctx.name, { resume: true });
  if (sb && !(await readState(sb))) {
    // Its first start failed half-way: start clean rather than clone into a VM that may have run anything since.
    await sb.delete();
    sb = null;
  }
  if (!sb) {
    sb = await ctx.api.create(ctx.name, {
      networkPolicy: networkPolicy(ctx.agent, true),
      timeoutMs: SESSION_TIMEOUT,
      ports: [PORT],
    });
    const url = `https://github.com/${ctx.github.owner}/${ctx.github.repo}.git`;
    let baseSha = (
      await sh(sb, SCRIPTS.clone, [url, ctx.github.branch], { env: gitAuth(ctx.github.token), timeoutMs: 120_000 })
    ).trim();
    await sh(sb, SCRIPTS.install, [], { timeoutMs: 300_000 });
    let docVersions: Record<string, string> = {};
    if (ctx.docs) ({ baseSha, docVersions } = await exportDocuments(sb, ctx.docs, baseSha));
    await writeState(sb, { baseSha, docVersions, provider: ctx.agent.provider, model: ctx.agent.model, runs: [] });
  }
  // Closes GitHub after a clone; also how a key changed on the Integrations screen reaches a running session.
  await sb.setNetworkPolicy(networkPolicy(ctx.agent));
  const install = AGENTS[ctx.agent.provider].install;
  if (install) await sh(sb, install, [], { timeoutMs: 120_000 });
  await restartDevServer(sb);
  return sessionStatus(ctx);
}

/** Start over: deletes the sandbox, unpublished changes included, and starts a fresh clone of the live branch. */
export async function startOver(ctx: EditorContext): Promise<EditorStatus> {
  await (await ctx.api.get(ctx.name))?.delete();
  return startSession(ctx);
}

async function runState(sb: SandboxHandle, id: string): Promise<'running' | 'lost' | number> {
  const out = (await sh(sb, SCRIPTS.runState, [id])).trim();
  return out === 'running' || out === 'lost' ? out : Number(out);
}

/** Records the end of the latest run; true when it just ended, which is when the dev server needs a restart. */
async function settleRun(sb: SandboxHandle, state: EditorSession): Promise<boolean> {
  const last = state.runs.at(-1);
  if (!last || last.finishedAt) return false;
  const now = await runState(sb, last.id);
  if (now === 'running') return false;
  last.finishedAt = new Date().toISOString();
  if (typeof now === 'number') last.exitCode = now;
  if (now === 0) last.summary = await readSummary(sb, state.provider, last.id);
  await writeState(sb, state);
  return true;
}

/** The summary file the run left, else (Claude) its final message, which the preamble asks to be the same text. */
async function readSummary(sb: SandboxHandle, provider: TextProviderId, id: string): Promise<string | undefined> {
  const file = await sh(sb, SCRIPTS.summary, [id]);
  if (file) return cleanSummary(file);
  if (provider !== 'anthropic') return undefined;
  const log = await sh(sb, SCRIPTS.logTail, [id]);
  return log ? cleanSummary(finalMessage(log)) : undefined;
}

/** Trimmed, at most two newlines in a row, capped; undefined when nothing is left. */
export function cleanSummary(text: string | undefined): string | undefined {
  const clean = (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return undefined;
  return clean.length > MAX_SUMMARY ? `${clean.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : clean;
}

/** Claude's stream-json: the text of the last successful result event. */
export function finalMessage(raw: string): string | undefined {
  for (const line of raw.split('\n').reverse()) {
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === 'result') return event.is_error ? undefined : String(event.result ?? '');
    } catch {
      // the tail can start mid-event
    }
  }
  return undefined;
}

const isRunning = (state: EditorSession) => {
  const last = state.runs.at(-1);
  return !!last && !last.finishedAt;
};

/** Run: starts the agent detached and returns at once; the status poll follows it. */
export async function startRun(ctx: EditorContext, prompt: unknown): Promise<EditorRun> {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new HttpError(400, 'Describe the change first');
  if (prompt.length > MAX_PROMPT) throw new HttpError(400, `The request is too long (over ${MAX_PROMPT} characters)`);
  const { sb, state } = await openSession(ctx);
  if (await settleRun(sb, state)) await restartDevServer(sb);
  if (isRunning(state)) throw new HttpError(409, 'A change is already running: wait for it to finish');
  await sb.setNetworkPolicy(networkPolicy(ctx.agent));
  // ponytail: past the plan's maximum (Hobby: 45 min) the session ends there; the files persist and Start resumes it.
  await sb.extendTimeout(SESSION_TIMEOUT).catch(() => undefined);
  const agent = AGENTS[ctx.agent.provider];
  if (agent.install) await sh(sb, agent.install, [], { timeoutMs: 120_000 });
  const resume = state.runs.length > 0 && state.provider === ctx.agent.provider;
  const run: EditorRun = {
    id: Date.now().toString(36),
    prompt: prompt.trim(),
    startedAt: new Date().toISOString(),
    by: ctx.by,
    byName: ctx.byName,
  };
  state.runs.push(run);
  state.provider = ctx.agent.provider;
  state.model = ctx.agent.model;
  await writeState(sb, state);
  await tagReview(sb, state);
  await sb.spawn(SCRIPTS.run, [run.id, ...agent.cli(ctx.agent.model, PREAMBLE + run.prompt, resume)], {
    ...SCRIPT_ENV,
    ...agent.env,
  });
  return run;
}

/** `git diff --name-status -z` and `--numstat -z` (both --no-renames, so a rename is a delete and an add). */
export function parseChanges(nameStatus: string, numstat: string): ChangedFile[] {
  const binary = new Set<string>();
  for (const entry of numstat.split('\0')) {
    const [added, deleted, path] = entry.split('\t');
    if (added === '-' && deleted === '-' && path) binary.add(path);
  }
  const fields = nameStatus.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [code, path] = [fields[i], fields[i + 1]];
    const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
    files.push({ path, status, binary: binary.has(path), allowed: inEditorScope(path) });
  }
  return files;
}

/** Claude's stream-json as readable lines: what it says, the tools it uses, its result. Other CLIs log plain text. */
export function renderLog(provider: TextProviderId, raw: string): string {
  if (provider !== 'anthropic') return raw;
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      // the tail can start mid-event; plain lines are the CLI's own messages
      if (!line.startsWith('{')) lines.push(line);
      continue;
    }
    if (event?.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block?.type === 'text' && block.text?.trim()) lines.push(block.text.trim());
        if (block?.type === 'tool_use') {
          const input = block.input ?? {};
          const what = input.file_path ?? input.command ?? input.pattern ?? input.path ?? '';
          lines.push(`→ ${block.name}${what ? ` ${String(what).slice(0, 200)}` : ''}`);
        }
      }
    } else if (event?.type === 'result') {
      lines.push(`${event.is_error ? 'Failed' : 'Done'}: ${String(event.result ?? '').trim()}`);
    }
  }
  return lines.join('\n');
}

async function changes(sb: SandboxHandle, base: string, runId = '') {
  const sep = `\n--${randomUUID()}--\n`;
  const [nameStatus, numstat, diff, log = ''] = (await sh(sb, SCRIPTS.status, [base, sep, runId])).split(sep);
  return { files: parseChanges(nameStatus, numstat), diff, log };
}

/** Status: the session, the latest run and its log, the preview URL, and every changed file with the diff. */
export async function sessionStatus(target: EditorTarget, blocked?: string): Promise<EditorStatus> {
  let sb: SandboxHandle | null;
  try {
    sb = await target.api.get(target.name);
  } catch (e) {
    // No Vercel credentials (local dev without `vercel env pull`) or the service is down: say so on the screen.
    if (e instanceof UpstreamError) return { state: 'unavailable', reason: e.message };
    throw e;
  }
  if (!sb) return { state: 'none', blocked };
  const state = sb.status === 'running' ? await readState(sb) : null;
  if (!state) return { state: 'stopped', blocked };
  if (await settleRun(sb, state)) await restartDevServer(sb);
  const last = state.runs.at(-1);
  const { files, diff, log } = await changes(sb, state.baseSha, last?.id);
  return {
    state: 'ready',
    blocked,
    previewUrl: sb.domain(PORT),
    provider: state.provider,
    model: state.model,
    run: last && { ...last, running: !last.finishedAt },
    requests: state.runs.map((r) => ({ prompt: r.prompt, summary: r.summary, by: r.by, byName: r.byName })),
    published: state.published,
    log: renderLog(state.provider, log),
    files: getMode() === 'postgres' ? files.map((f) => ({ ...f, document: isDocumentPath(f.path) })) : files,
    diff: diff.slice(0, MAX_DIFF),
    diffTruncated: diff.length > MAX_DIFF,
  };
}

/** Status for the screen: why Start can't work, if it can't, alongside whatever session exists. */
export async function editorStatus(store: ContentStore, user: SessionUser): Promise<EditorStatus> {
  let target: EditorTarget;
  try {
    target = editorTarget();
  } catch (e) {
    if (e instanceof HttpError) return { state: 'unavailable', reason: e.message };
    throw e;
  }
  let blocked: string | undefined;
  await editorContext(store, user).catch((e) => {
    if (!(e instanceof HttpError)) throw e;
    blocked = e.message;
  });
  return sessionStatus(target, blocked);
}

/**
 * Discard: back to the session's base (and, in Postgres mode, the database's current content). Local only: bringing
 * the code up to date with GitHub is Start over, so no token ever enters a VM an agent has run in.
 */
export async function discardChanges(ctx: EditorContext): Promise<EditorStatus> {
  const { sb, state } = await openSession(ctx);
  await settleRun(sb, state);
  if (isRunning(state)) throw new HttpError(409, 'A change is running: wait for it to finish');
  await sh(sb, SCRIPTS.discard, [state.baseSha]);
  if (ctx.docs) Object.assign(state, await exportDocuments(sb, ctx.docs, state.baseSha));
  state.runs = [];
  await writeState(sb, state);
  await tagReview(sb, state);
  await restartDevServer(sb);
  return sessionStatus(ctx);
}

/**
 * Stop: ends the running agent and whatever it started; what it changed so far stays, like any finished run. Needs
 * no provider key, so a run can be stopped after its key was removed.
 */
export async function stopRun(target: EditorTarget): Promise<EditorStatus> {
  const { sb, state } = await openSession(target);
  const last = state.runs.at(-1);
  if (last && !last.finishedAt && (await runState(sb, last.id)) === 'running') {
    await sh(sb, SCRIPTS.stop, [last.id]);
    last.finishedAt = new Date().toISOString();
    await writeState(sb, state);
    await restartDevServer(sb);
  }
  return sessionStatus(target);
}

/** Revert one changed file to the session's base, so one refused file doesn't cost the rest of the changes. */
export async function revertFile(target: EditorTarget, path: unknown): Promise<EditorStatus> {
  const { sb, state } = await openSession(target);
  await settleRun(sb, state);
  if (isRunning(state)) throw new HttpError(409, 'A change is running: wait for it to finish');
  const { files } = await changes(sb, state.baseSha);
  // Only a path git itself listed: anything else could name a file outside the checkout.
  if (typeof path !== 'string' || !files.some((f) => f.path === path)) {
    throw new HttpError(400, 'That file has no change to undo');
  }
  await sh(sb, SCRIPTS.revert, [state.baseSha, path]);
  await restartDevServer(sb);
  return sessionStatus(target);
}

/** Text when the bytes are UTF-8 without NULs, base64 otherwise. */
function toChange(path: string, bytes: Buffer | null): Change {
  if (bytes === null) return { path, content: null };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.includes('\0')) return { path, content: text };
  } catch {
    // not UTF-8
  }
  return { path, content: bytes.toString('base64'), encoding: 'base64' };
}

const drift = (path: string) =>
  new HttpError(
    409,
    `The site changed since this session started (${path}): use Start over for a fresh copy (it drops this session's unpublished changes)`,
    { path },
  );

export interface PublishResult {
  /** The GitHub commit, when there was code (or, in git mode, anything) to commit. */
  commit?: { id: string; url?: string };
  /** Postgres mode: the documents saved to the database. */
  documents?: string[];
  warning?: CommitResult['warning'];
  tags?: string[];
  detail?: string;
}

/**
 * Publish: one GitHub commit with every change (git mode), or code to GitHub then documents to the database
 * (Postgres mode). Base versions come from the session's base, so anything changed upstream since is a 409.
 */
export async function publish(ctx: EditorContext, message?: unknown): Promise<PublishResult> {
  const { sb, state } = await openSession(ctx);
  await settleRun(sb, state);
  if (isRunning(state)) throw new HttpError(409, 'A change is running: wait for it to finish');
  const { files } = await changes(sb, state.baseSha);
  if (files.length === 0) throw new HttpError(400, 'There are no changes to publish');
  const refused = files.filter((f) => !f.allowed).map((f) => f.path);
  if (refused.length) {
    throw new HttpError(400, `The editor may not change ${refused.join(', ')}: discard and ask again`, refused);
  }
  const all = await Promise.all(
    files.map(async (f) =>
      toChange(f.path, f.status === 'deleted' ? null : await sb.readFile(`${SITE_DIR}/${f.path}`)),
    ),
  );
  const docs = ctx.docs ? all.filter((c) => isDocumentPath(c.path)) : [];
  const code = all.filter((c) => !docs.includes(c));
  // commitChanges checks these again, but by then the code commit would already be live.
  for (const c of docs) assertAllowed(c.path);
  const text = (typeof message === 'string' && message.trim()) || defaultCommitMessage(state.runs.map((r) => r.prompt));

  const result: PublishResult = {};
  if (code.length) {
    const paths = code.map((c) => c.path);
    const shas = (await sh(sb, SCRIPTS.blobs, [state.baseSha, ...paths])).split('\n');
    const base = Object.fromEntries(paths.map((p, i) => [p, shas[i]?.trim() || null]));
    let commit: CommitResult;
    try {
      commit = await ctx.code.commit(code, `${text}\n\n${EDITOR_TRAILER}`, base);
    } catch (e) {
      throw e instanceof ConflictError ? drift(e.path) : e;
    }
    result.commit = { id: commit.id, url: commit.url };
    state.published = { ...result.commit, at: new Date().toISOString(), undoable: docs.length === 0 };
    // The tree already holds what was published: a local commit is the next base, with no fetch and no token.
    state.baseSha = await advance(sb, state.baseSha, text, paths);
    await writeState(sb, state);
  }
  if (docs.length && ctx.docs) {
    const paths = docs.map((c) => c.path);
    let saved: CommitResult;
    try {
      saved = await commitChanges(
        ctx.docs,
        docs,
        text,
        Object.fromEntries(paths.map((p) => [p, state.docVersions[p] ?? null])),
      );
    } catch (e) {
      const failure = e instanceof ConflictError ? drift(e.path) : null;
      if (!result.commit) throw failure ?? e;
      const why = e instanceof Error ? e.message : String(e);
      throw new HttpError(
        failure?.status ?? (e instanceof UpstreamError ? e.status : 500),
        `The code is live (${result.commit.url ?? result.commit.id}), but the content was not saved: ${why}. Publish again to retry the content.`,
        { commit: result.commit, documents: paths },
      );
    }
    for (const [p, v] of Object.entries(saved.versions)) {
      if (v === null) delete state.docVersions[p];
      else state.docVersions[p] = v;
    }
    state.baseSha = await advance(sb, state.baseSha, text, paths);
    result.documents = paths;
    if (saved.warning) Object.assign(result, { warning: saved.warning, tags: saved.tags, detail: saved.detail });
  }
  state.runs = [];
  await writeState(sb, state);
  await tagReview(sb, state);
  return result;
}

/** GitHub's side of Undo this publish (GitHubStore); the editor's code store in both modes. */
interface Reverter {
  revertChanges(sha: string): Promise<{ message: string; changes: Change[]; base: Record<string, string | null> }>;
  latestCommitWith(trailer: string): Promise<string | null>;
}

/**
 * Undo this publish: commits the files of publish commit `sha` back to their state before it, through the same
 * commit path and base check as Publish. `sha` comes from the admin's browser (Publish returned it), and the file
 * list and old contents from GitHub. The sandbox's state.json, which the agent can write, is only a first filter:
 * GitHub must also name `sha` as the branch's newest editor publish, so a forged older publish id is refused.
 * Also refused unless the commit touches only files the editor may publish, and no later commit touched them.
 */
export async function undoPublish(ctx: EditorContext, sha: unknown): Promise<EditorStatus> {
  if (typeof sha !== 'string' || !/^[0-9a-f]{1,64}$/.test(sha)) throw new HttpError(400, 'Say which publish to undo');
  const { sb, state } = await openSession(ctx);
  await settleRun(sb, state);
  if (isRunning(state)) throw new HttpError(409, 'A change is running: wait for it to finish');
  if (state.published?.id !== sha) {
    throw new HttpError(
      409,
      'Only the last publish from this screen can be undone: ask for the change back and publish again',
    );
  }
  if ((await changes(sb, state.baseSha)).files.length) {
    throw new HttpError(409, 'Publish or discard the current changes first, then undo the last publish');
  }
  if (!('revertChanges' in ctx.code)) throw new HttpError(400, 'Undo needs the site’s GitHub repository');
  const github = ctx.code as ContentStore & Reverter;
  if ((await github.latestCommitWith(EDITOR_TRAILER)) !== sha) {
    throw new HttpError(
      409,
      'Only the last publish from the Site editor can be undone: ask for the change back and publish again',
    );
  }
  const target = await github.revertChanges(sha);
  const outside = target.changes.map((c) => c.path).filter((p) => !inEditorScope(p) || (ctx.docs && isDocumentPath(p)));
  if (outside.length) {
    throw new HttpError(
      409,
      `That publish changed files the Site editor may not change (${outside.join(', ')}), so it can’t be undone here`,
      outside,
    );
  }
  const message = `Undo: ${target.message.split('\n')[0]}`;
  let commit: CommitResult;
  try {
    commit = await ctx.code.commit(target.changes, message, target.base);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    throw new HttpError(
      409,
      `This publish can’t be undone here: ${e.path} changed on GitHub after it. Ask for the change back and publish again`,
      { path: e.path },
    );
  }
  // The sandbox follows with GitHub's contents, so the next publish starts from what is live.
  const paths = target.changes.map((c) => c.path);
  const kept = target.changes.filter((c) => c.content !== null);
  if (kept.length) {
    await sb.writeFiles(
      kept.map((c) => ({
        path: `${SITE_DIR}/${c.path}`,
        content: Buffer.from(c.content!, c.encoding === 'base64' ? 'base64' : 'utf8'),
      })),
    );
  }
  const gone = target.changes.filter((c) => c.content === null).map((c) => c.path);
  if (gone.length) await sh(sb, SCRIPTS.remove, gone);
  state.published = { id: commit.id, url: commit.url, at: new Date().toISOString(), undoable: false };
  state.baseSha = await advance(sb, state.baseSha, message, paths);
  await writeState(sb, state);
  await restartDevServer(sb);
  return sessionStatus(ctx);
}

/** End: stops the sandbox; its filesystem is kept and the next Start resumes it. */
export async function endSession(target: EditorTarget): Promise<EditorStatus> {
  const sb = await target.api.get(target.name);
  if (sb?.status === 'running') await sb.stop();
  return { state: sb ? 'stopped' : 'none' };
}
