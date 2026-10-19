import { randomBytes } from 'node:crypto';

type Env = Record<string, string | undefined>;

const PASS_THROUGH = [
  'SESSION_SECRET',
  'BLOB_READ_WRITE_TOKEN',
  'CRON_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'MEDIUM_TOKEN',
];

const MISSING_DEV =
  'DEV_DATABASE_URL is not set. Create a `dev` branch in the Neon console and add its connection string to .env.local ' +
  'as DEV_DATABASE_URL (the DATABASE_URL that `vercel env pull` writes is production and is never used locally).';

/** The database's host without Neon's `-pooler` suffix; null when the URL doesn't parse. */
function databaseHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^([^.]*?)-pooler(?=\.|:|$)/, '$1');
  } catch {
    return null;
  }
}

function assertNotProduction(dev: string, production: string | undefined) {
  const host = databaseHost(dev);
  if (production && host && host === databaseHost(production)) {
    throw new Error(
      "DEV_DATABASE_URL points at the same database as DATABASE_URL (production) — use the dev branch's connection string",
    );
  }
}

/**
 * The environment for `astro dev` in Postgres mode: the shell's, the pulled secrets, VERCEL=1, and DATABASE_URL set
 * to DEV_DATABASE_URL — never to a DATABASE_URL from .env.local or the shell (that one is production).
 */
export function devEnv(
  fileEnv: Env,
  shellEnv: NodeJS.ProcessEnv,
  generateSecret = () => randomBytes(32).toString('base64url'),
): Record<string, string> {
  const pick = (k: string) => shellEnv[k] ?? fileEnv[k];
  const dev = pick('DEV_DATABASE_URL');
  if (!dev) throw new Error(MISSING_DEV);
  assertNotProduction(dev, fileEnv.DATABASE_URL);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(shellEnv)) if (v !== undefined) out[k] = v;
  // The daily backup must only ever mirror production: no GitHub token for dev, whatever the shell holds.
  delete out.GITHUB_TOKEN;
  for (const k of PASS_THROUGH) {
    const v = pick(k);
    if (v) out[k] = v;
  }
  out.SESSION_SECRET = pick('SESSION_SECRET') || generateSecret();
  out.VERCEL = '1';
  out.DATABASE_URL = dev;
  return out;
}

/** Scripts default to the dev branch; `--production` targets DATABASE_URL on purpose. */
export function databaseFor(env: Env, production: boolean): string {
  const url = production ? env.DATABASE_URL : env.DEV_DATABASE_URL;
  if (!url) throw new Error(production ? 'DATABASE_URL is not set (run `vercel env pull .env.local`).' : MISSING_DEV);
  if (!production) assertNotProduction(url, env.DATABASE_URL);
  return url;
}

/** For printing: `new URL`'s error would echo the whole string, password included. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable URL)';
  }
}

export const confirmsProduction = (typed: string, username: string) =>
  typed.trim().toLowerCase() === username.trim().toLowerCase();
