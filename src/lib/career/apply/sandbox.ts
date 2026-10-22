// Runs runner.mjs in the apply sandbox: one persistent VM, reused one run at a time (the apply lock), that holds no
// secrets. Each call works in its own directory, so even a run that outlived its lock can't read another's files.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { NetworkPolicy, SandboxApi, SandboxHandle } from '../../admin/editor';
import { vercelSandbox } from '../../admin/sandbox';
import type { RunnerInput, RunnerResult } from './types';

const NAME = 'scholaros-apply';
const DIR = '/vercel/sandbox/apply';
const SESSION_MS = 10 * 60_000;
const RUN_MS = 240_000;

/**
 * Open to any employer's site, closed to private, loopback and link-local IPv4 ranges (cloud metadata, the VM's
 * neighbours): a deny wins over the `*` allow.
 */
export const APPLY_POLICY: NetworkPolicy = {
  allow: { '*': [] },
  subnets: {
    deny: [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.0.0/16',
      '127.0.0.0/8',
      '100.64.0.0/10',
      // IPv6 ranges (fc00::/7, fe80::/10) are refused by the API: "Invalid CIDR" (3.7.0, October 2026).
    ],
  },
};

// Playwright pinned to the repo's @playwright/test major (runner.test.ts runs against that); the marker makes later
// boots skip the install, since a persistent sandbox keeps its files. A run's directory left by a call that died
// (a CV inside) is swept once it is 15 minutes old.
const INSTALL = `set -e
mkdir -p ${DIR}/runs && cd ${DIR}
find runs -mindepth 1 -maxdepth 1 -mmin +15 -exec rm -rf {} +
test -f .installed && exit 0
test -f package.json || npm init -y >/dev/null
npm i playwright@1.64 >/dev/null
sudo npx playwright install-deps chromium >/dev/null
npx playwright install chromium >/dev/null
touch .installed`;

// $1 is the run's input.json; runner.mjs beside it finds playwright in ${DIR}/node_modules.
const RUN = `cd "$(dirname "$1")" && node runner.mjs "$1"`;

/** The runner ran, or may have run, but no result came back: a submit must treat it as possibly sent. */
export class RunnerLostError extends Error {}

let testApi: SandboxApi | null = null;

/** Tests swap the Vercel SDK adapter; production code never calls this. */
export function setApplySandboxForTests(api: SandboxApi | null): void {
  testApi = api;
}

async function runnerSource(): Promise<string> {
  const raw = (await import('./runner.mjs?raw')) as { default?: unknown };
  // The site build (Vite) gives the text; plain Node (tsx: tests, scripts) ignores `?raw` and gives the module.
  return typeof raw.default === 'string' ? raw.default : readFile(new URL('./runner.mjs', import.meta.url), 'utf8');
}

async function download(url: string | undefined, what: string): Promise<Buffer | undefined> {
  if (!url) return undefined;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Could not download the ${what} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function check(sb: SandboxHandle, script: string, timeoutMs: number): Promise<void> {
  const r = await sb.run(script, [], { timeoutMs });
  if (r.exitCode !== 0) {
    const why = r.stderr.trim().split('\n').slice(-5).join('\n') || `exit code ${r.exitCode}`;
    throw new Error(`Setting up the browser failed: ${why}`);
  }
}

export type ApplyRun = Omit<RunnerInput, 'out' | 'files'> & { cvPdfUrl?: string; letterPdfUrl?: string };

/** Stops the apply VM. Only the apply lock's holder calls this, as it lets go (releaseApplyLock). */
export async function stopApplySandbox(): Promise<void> {
  const sb = await (testApi ?? vercelSandbox).get(NAME).catch(() => null);
  // eslint-disable-next-line no-console
  await sb?.stop().catch((e) => console.error('[career] stopping the apply sandbox', e));
}

/**
 * One runner call, in a directory of its own that is removed afterwards. The CV and letter PDFs are downloaded here
 * and written into the VM; the screenshots and letter PDF the runner names come back in `files`, keyed by the path in
 * the result. The VM keeps running: its lock's holder stops it (stopApplySandbox). Anything
 * that fails before the runner starts throws a plain Error (nothing was opened); once it has started, a missing
 * result throws RunnerLostError.
 */
export async function runInApplySandbox(input: ApplyRun): Promise<RunnerResult & { files: Record<string, Buffer> }> {
  const { cvPdfUrl, letterPdfUrl, ...rest } = input;
  const [source, cv, letter] = await Promise.all([
    runnerSource(),
    download(cvPdfUrl, 'tailored CV'),
    download(letterPdfUrl, 'cover letter'),
  ]);
  const api = testApi ?? vercelSandbox;
  const sb =
    (await api.get(NAME, { resume: true })) ??
    (await api.create(NAME, { networkPolicy: APPLY_POLICY, timeoutMs: SESSION_MS, ports: [] }));
  const dir = `${DIR}/runs/${randomUUID()}`;
  try {
    // A sandbox created before a policy change keeps its old one until told.
    await sb.setNetworkPolicy(APPLY_POLICY);
    await sb.extendTimeout(SESSION_MS).catch(() => undefined);
    await check(sb, `${INSTALL}\nmkdir -p ${dir}`, 480_000);
    const runner: RunnerInput = {
      ...rest,
      out: `${dir}/out`,
      files: { ...(cv ? { cv: `${dir}/cv.pdf` } : {}), ...(letter ? { letter: `${dir}/letter-approved.pdf` } : {}) },
    };
    await sb.writeFiles([
      { path: `${dir}/runner.mjs`, content: Buffer.from(source) },
      { path: `${dir}/input.json`, content: Buffer.from(JSON.stringify(runner)) },
      ...(cv ? [{ path: runner.files!.cv!, content: cv }] : []),
      ...(letter ? [{ path: runner.files!.letter!, content: letter }] : []),
    ]);
    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await sb.run(RUN, [`${dir}/input.json`], { timeoutMs: RUN_MS }));
    } catch (e) {
      throw new RunnerLostError(`The browser run ended without a result: ${(e as Error).message}`);
    }
    let result: RunnerResult;
    try {
      result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
    } catch {
      const why = stderr.trim().split('\n').slice(-3).join(' ') || 'no output';
      throw new RunnerLostError(`The browser run ended without a result: ${why}`);
    }
    const files: Record<string, Buffer> = {};
    for (const path of [...result.shots, ...(result.letterPdf ? [result.letterPdf] : [])]) {
      // A missing screenshot must not turn a run that happened into an error.
      const buf = await sb.readFile(path).catch(() => null);
      if (buf) files[path] = buf;
    }
    return { ...result, files };
  } finally {
    // eslint-disable-next-line no-console
    await sb.run('rm -rf "$1"', [dir]).catch((e) => console.error('[career] removing an apply run directory', e));
  }
}
