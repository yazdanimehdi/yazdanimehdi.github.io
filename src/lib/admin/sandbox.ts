import { APIError, Sandbox } from '@vercel/sandbox';
import type { SandboxApi, SandboxHandle } from './editor';
import { UpstreamError } from './store';

const CALL_TIMEOUT = 60_000;

/** One SDK call with a deadline; any failure is a 502 "Vercel Sandbox: …". */
async function sdk<T>(what: string, call: (signal: AbortSignal) => Promise<T>, ms = CALL_TIMEOUT): Promise<T> {
  try {
    return await call(AbortSignal.timeout(ms));
  } catch (e) {
    throw new UpstreamError(`Vercel Sandbox: ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function handle(s: Sandbox): SandboxHandle {
  return {
    get status() {
      return s.status;
    },
    run: (script, args = [], opts = {}) =>
      sdk(
        'a command',
        async (signal) => {
          const r = await s.runCommand({
            cmd: 'bash',
            args: ['-lc', script, 'bash', ...args],
            env: opts.env,
            timeoutMs: opts.timeoutMs,
            signal,
          });
          return { exitCode: r.exitCode, stdout: await r.stdout(), stderr: await r.stderr() };
        },
        (opts.timeoutMs ?? CALL_TIMEOUT) + 15_000,
      ),
    // No abort signal: aborting it later would kill the detached process.
    spawn: (script, args = [], env) =>
      sdk('starting a command', async () => {
        await s.runCommand({ cmd: 'bash', args: ['-lc', script, 'bash', ...args], env, detached: true });
      }),
    readFile: (path) => sdk(`reading ${path}`, (signal) => s.readFileToBuffer({ path }, { signal })),
    writeFiles: (files) => sdk('writing files', (signal) => s.writeFiles(files, { signal })),
    domain: (port) => s.domain(port),
    setNetworkPolicy: (networkPolicy) =>
      sdk('updating the network policy', (signal) => s.update({ networkPolicy }, { signal })),
    extendTimeout: (ms) => sdk('extending the session', (signal) => s.extendTimeout(ms, { signal })),
    stop: () => sdk('stopping the session', async (signal) => void (await s.stop({ signal }))),
    delete: () =>
      sdk('deleting the session', async (signal) => {
        if (s.status === 'running') await s.stop({ signal });
        await s.delete({ signal });
      }),
  };
}

/** The Vercel Sandbox SDK behind the editor's SandboxApi; credentials come from VERCEL_OIDC_TOKEN (automatic on Vercel). */
export const vercelSandbox: SandboxApi = {
  get: (name, opts = {}) =>
    sdk(
      'looking up the session',
      async (signal) => {
        try {
          return handle(await Sandbox.get({ name, resume: opts.resume, signal }));
        } catch (e) {
          if (e instanceof APIError && e.response.status === 404) return null;
          throw e;
        }
      },
      opts.resume ? 180_000 : CALL_TIMEOUT,
    ),
  create: (name, opts) =>
    sdk(
      'creating the session',
      async (signal) =>
        handle(
          await Sandbox.create({
            name,
            ports: opts.ports,
            timeout: opts.timeoutMs,
            networkPolicy: opts.networkPolicy,
            resources: { vcpus: 2 },
            persistent: true,
            keepLastSnapshots: { count: 1 },
            signal,
          }),
        ),
      180_000,
    ),
};
