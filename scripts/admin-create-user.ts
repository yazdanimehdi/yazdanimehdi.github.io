#!/usr/bin/env tsx
/**
 * pnpm admin:create-user <username> [--reset] [--production]
 * Creates a password account (or with --reset sets a new password) on the dev branch (DEV_DATABASE_URL), or with
 * --production on DATABASE_URL after you type the username again.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { createAccount, resetPassword } from '../src/lib/admin/accounts';
import { migrate } from '../src/lib/db-migrate';
import type { Sql } from '../src/lib/db';
import { confirmsProduction, databaseFor, hostOf } from '../src/lib/dev-env';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'));
const production = args.includes('--production');
const resetting = args.includes('--reset');
if (!username) {
  console.error('Usage: pnpm admin:create-user <username> [--reset] [--production]');
  process.exit(1);
}
const file = path.join(ROOT, '.env.local');
const env = { ...(fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}), ...process.env };

function ask(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden)
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

let url: string;
try {
  url = databaseFor(env, production);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
console.log(`${production ? 'PRODUCTION' : 'Dev branch'} database: ${hostOf(url)}`);
if (production && !confirmsProduction(await ask(`Type the username (${username}) to confirm: `), username)) {
  console.error('Not confirmed; nothing written.');
  process.exit(1);
}
const name = resetting ? '' : await ask('Display name: ');
const password = await ask('Password (12+ characters): ', true);
if ((await ask('Password again: ', true)) !== password) {
  console.error('The passwords don’t match; nothing written.');
  process.exit(1);
}
const client = postgres(url, { max: 1, prepare: false });
const sql = client as unknown as Sql;
try {
  await migrate(sql, path.join(ROOT, 'migrations'));
  if (resetting) {
    await resetPassword(sql, username, password);
    console.log(`New password set for ${username}; their sessions have ended.`);
  } else {
    const account = await createAccount(sql, username, name, password);
    console.log(`Created ${account.username}. Sign in at /<adminPath>/login.`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
