// The drafting worker: the configured API provider, or an agent CLI run once per call in the worker sandbox. Draft,
// review, form answers and application values all go through `workerText`; scoring stays on the API.
import { randomUUID } from 'node:crypto';
import { generateText, readAiConfig } from '../admin/ai';
import {
  AGENTS,
  networkPolicy,
  PLACEHOLDER,
  type CommandResult,
  type NetworkPolicy,
  type SandboxApi,
} from '../admin/editor';
import { vercelSandbox } from '../admin/sandbox';
import { getSecret, missingKey, secretsDb, setSecret, type SecretName } from '../admin/secrets';
import type { ContentStore } from '../admin/store';
import { TEXT_PROVIDERS, type TextInput, type TextProviderId } from '../ai/providers';
import type { CareerPrefs } from './settings';

/** The subscription (or the key's credit) ran out. Never answered by falling back to the API. */
export class QuotaError extends Error {}

type Cli = Extract<CareerPrefs['worker'], { kind: 'cli' }>;

const NAME = 'scholaros-worker';
const ROOT = '/vercel/sandbox/worker';
const SESSION_MS = 5 * 60_000;
const RUN_MS = 240_000;
const BY = 'ScholarOS jobs';

const PROVIDER: Record<Cli['agent'], TextProviderId> = { claude: 'anthropic', codex: 'openai', gemini: 'google' };
const LABEL: Record<Cli['agent'], string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };

/**
 * Installs `pkg@min` unless `bin --version` is already at least `min`: the sandbox image's preinstalled CLIs can be
 * older than the flags RUN uses. A marker per version skips the check on later calls in the same VM.
 */
const atLeast = (bin: string, pkg: string, min: string) => {
  const marker = `"$HOME/.scholaros-cli/${bin}-${min}"`;
  return `test -f ${marker} || {
  v=$(${bin} --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -1)
  if [ -z "$v" ] || ! printf '%s\\n%s\\n' ${min} "$v" | sort -V -C; then npm i -g ${pkg}@${min} >/dev/null || exit 1; fi
  mkdir -p "$HOME/.scholaros-cli" && touch ${marker}
}`;
};
// The versions RUN's flags were checked with (--help).
const INSTALL: Record<Cli['agent'], string> = {
  claude: atLeast('claude', '@anthropic-ai/claude-code', '2.1.305'),
  codex: atLeast('codex', '@openai/codex', '0.163.0'),
  gemini: atLeast('gemini', '@google/gemini-cli', '0.65.0'),
};

// One-shot, tool-less runs (the editor's AGENTS lines run tool-using agents). $1 is the call's own directory; the
// prompt arrives on stdin, so its size and a leading "-" don't matter.
const RUN: Record<Cli['agent'], string> = {
  claude: `cd "$1" && claude -p --output-format json --tools "" --no-session-persistence --system-prompt "$(cat system.txt)" < prompt.txt`,
  codex: `cd "$1" && mkdir -p codex && CODEX_HOME="$1/codex" codex exec --skip-git-repo-check -s read-only -o last.txt - < prompt.txt`,
  gemini: `cd "$1" && gemini --skip-trust --output-format json -p 'Answer the request above.' < prompt.txt`,
};
/**
 * A call that died half-way leaves its directory (a Codex sign-in included): swept once it is 15 minutes old. No
 * `exit` here: the install runs after it in the same script.
 */
const PREP = `mkdir -p ${ROOT} && find ${ROOT} -mindepth 1 -maxdepth 1 -mmin +15 -exec rm -rf {} +; true`;
/** Prints `idle` when no other call is using the VM, so the last one out stops it. */
const CLEAN = `rm -rf "$1"; rmdir ${ROOT} 2>/dev/null && echo idle; exit 0`;

const QUOTA = /usage limit|rate limit|quota|insufficient credits|credit balance|limit reached|hit your limit/i;

let testApi: SandboxApi | null = null;

/** Tests swap the Vercel SDK adapter; production code never calls this. */
export function setWorkerSandboxForTests(api: SandboxApi | null): void {
  testApi = api;
}

/** Gemini CLI has no sign-in that works unattended (the Antigravity slot), so it always runs on the Gemini API key. */
const subscription = (w: Cli) => w.auth === 'subscription' && w.agent !== 'gemini';

function secretOf(w: Cli): SecretName {
  if (subscription(w)) return w.agent === 'claude' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'CODEX_AUTH_JSON';
  return TEXT_PROVIDERS[PROVIDER[w.agent]].keys[0];
}

/** Why the worker can't run (a key or sign-in it needs isn't set), or null. */
export async function workerMissing(store: ContentStore, prefs: CareerPrefs): Promise<string | null> {
  const w = prefs.worker;
  const names = w.kind === 'api' ? TEXT_PROVIDERS[(await readAiConfig(store)).text.provider].keys : [secretOf(w)];
  for (const name of names) if (!(await getSecret(secretsDb(store), name))) return missingKey(name).message;
  return null;
}

/**
 * The policy carries the real credential where the firewall can broker it, and the VM sees PLACEHOLDER. Codex's
 * sign-in can't be brokered (it reads and refreshes a file), so its egress is limited to OpenAI's hosts instead.
 */
function access(w: Cli, secret: string): { policy: NetworkPolicy; env: Record<string, string> } {
  const provider = PROVIDER[w.agent];
  const keyed = networkPolicy({ provider, model: '', key: secret });
  if (!subscription(w)) return { policy: keyed, env: AGENTS[provider].env };
  const { [AGENTS[provider].domain]: _, ...npm } = keyed.allow;
  if (w.agent === 'claude') {
    return {
      policy: {
        allow: {
          ...npm,
          [AGENTS.anthropic.domain]: [{ transform: [{ headers: { authorization: `Bearer ${secret}` } }] }],
        },
      },
      env: { CLAUDE_CODE_OAUTH_TOKEN: PLACEHOLDER, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    };
  }
  return { policy: { allow: { ...npm, 'api.openai.com': [], 'chatgpt.com': [], 'auth.openai.com': [] } }, env: {} };
}

const tail = (text: string) => text.trim().split('\n').slice(-5).join('\n').trim().slice(0, 300);

function json(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** The CLI's answer, or why it failed: a QuotaError when the failure reads like an exhausted quota. */
function answer(agent: Cli['agent'], r: CommandResult, last: string | null): string {
  let why: string;
  if (agent === 'claude') {
    const out = json(r.stdout.trim());
    if (r.exitCode === 0 && out && !out.is_error && typeof out.result === 'string') return out.result;
    why = typeof out?.result === 'string' && out.result ? out.result : tail(r.stderr || r.stdout);
  } else if (agent === 'gemini') {
    const out = json(r.stdout.trim());
    if (r.exitCode === 0 && typeof out?.response === 'string') return out.response;
    const err = out?.error as { message?: unknown } | undefined;
    why = typeof err?.message === 'string' ? err.message : tail(r.stderr || r.stdout);
  } else {
    if (r.exitCode === 0 && last?.trim()) return last;
    why = tail(r.stderr || r.stdout);
  }
  why = tail(why) || `exit code ${r.exitCode}`;
  if (!QUOTA.test(why)) throw new Error(`${LABEL[agent]} failed: ${why}`);
  // Claude Code's own form: "Claude AI usage limit reached|<epoch seconds>".
  const until = /limit reached\|(\d{9,})/.exec(why);
  throw new QuotaError(
    until ? `Your Claude subscription is out of quota until ${new Date(Number(until[1]) * 1000).toUTCString()}` : why,
  );
}

/** Every token-like string in a Codex auth.json. */
function tokens(authJson: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.length >= 16) out.push(v);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(json(authJson));
  return out;
}

async function runCli(store: ContentStore, w: Cli, input: TextInput): Promise<string> {
  if (input.pdf) throw new Error('An agent CLI cannot read a PDF here: switch the drafting worker to an API provider');
  const sql = secretsDb(store);
  const name = secretOf(w);
  const secret = await getSecret(sql, name);
  if (!secret) throw missingKey(name);
  const { policy, env } = access(w, secret);
  const codexAuth = subscription(w) && w.agent === 'codex';
  const api = testApi ?? vercelSandbox;
  const sb =
    (await api.get(NAME, { resume: true })) ??
    (await api.create(NAME, { networkPolicy: policy, timeoutMs: SESSION_MS, ports: [] }));
  // Every call sets it: calls share the VM, and they all run the one configured worker.
  await sb.setNetworkPolicy(policy);
  await sb.extendTimeout(SESSION_MS).catch(() => undefined);
  const install = await sb.run(`${PREP}\n${INSTALL[w.agent]}`, [], { timeoutMs: 180_000 });
  if (install.exitCode !== 0) throw new Error(`Installing ${LABEL[w.agent]} failed: ${tail(install.stderr)}`);
  const dir = `${ROOT}/${randomUUID()}`;
  const prompt = w.agent === 'claude' ? input.prompt : `${input.system}\n\n${input.prompt}`;
  try {
    await sb.writeFiles([
      { path: `${dir}/system.txt`, content: Buffer.from(input.system) },
      { path: `${dir}/prompt.txt`, content: Buffer.from(prompt) },
      ...(codexAuth ? [{ path: `${dir}/codex/auth.json`, content: Buffer.from(secret) }] : []),
    ]);
    const r = await sb.run(RUN[w.agent], [dir], { env, timeoutMs: RUN_MS });
    const last = w.agent === 'codex' ? ((await sb.readFile(`${dir}/last.txt`))?.toString() ?? null) : null;
    let refreshed: string | null = null;
    if (codexAuth) {
      refreshed = (await sb.readFile(`${dir}/codex/auth.json`))?.toString() ?? null;
      // Codex refreshes its sign-in in place; the new one replaces the sealed one so the next run isn't signed out.
      if (refreshed && refreshed.trim() !== secret.trim() && json(refreshed) && sql) {
        await setSecret(sql, 'CODEX_AUTH_JSON', refreshed, BY);
      }
    }
    const text = answer(w.agent, r, last);
    // Codex can read files, and a posting may ask it to: an answer quoting the sign-in never leaves this function.
    if (codexAuth && [...tokens(secret), ...tokens(refreshed ?? '')].some((t) => text.includes(t))) {
      throw new Error('The Codex answer contained your sign-in, so it was discarded');
    }
    return text;
  } finally {
    // ponytail: a call starting in the instant between `idle` and stop() fails and is retried by its own caller.
    const idle = await sb
      .run(CLEAN, [dir])
      .then((c) => c.stdout.includes('idle'))
      .catch(() => false);
    // eslint-disable-next-line no-console
    if (idle) await sb.stop().catch((e) => console.error('[career] stopping the worker sandbox', e));
  }
}

/**
 * The drafting worker's reply to `input`. An API worker is `generateText` with the site's AI settings; a CLI worker
 * runs its agent once in the worker sandbox and never falls back to the API, whatever goes wrong.
 */
export async function workerText(store: ContentStore, prefs: CareerPrefs, input: TextInput): Promise<string> {
  const w = prefs.worker;
  if (w.kind === 'api') return generateText(store, await readAiConfig(store), input);
  return runCli(store, w, input);
}
