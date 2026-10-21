#!/usr/bin/env tsx
/** pnpm dev:postgres — `astro dev` in Postgres mode against the Neon dev branch (DEV_DATABASE_URL in .env.local). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { migrate } from '../src/lib/db-migrate';
import type { Sql } from '../src/lib/db';
import { devEnv, hostOf } from '../src/lib/dev-env';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, '.env.local');
const fileEnv = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
let env: Record<string, string>;
try {
  env = devEnv(fileEnv, process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (!fileEnv.SESSION_SECRET && !process.env.SESSION_SECRET) {
  console.log('No SESSION_SECRET in .env.local: using a temporary one (sessions end when this server stops).');
}
console.log(`Postgres mode on the dev branch: ${hostOf(env.DATABASE_URL)}`);
const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });
try {
  const applied = await migrate(client as unknown as Sql, path.join(ROOT, 'migrations'));
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
} finally {
  await client.end();
}
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'dev', ...process.argv.slice(2)],
  {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  },
);
child.on('exit', (code) => process.exit(code ?? 0));
