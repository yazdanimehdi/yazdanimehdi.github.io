#!/usr/bin/env tsx
/**
 * Runs before `astro build` on Vercel (package.json `vercel-build`). In Postgres mode it sets up the database
 * (src/lib/db-bootstrap.ts); otherwise it does nothing. This is what makes the Deploy button a one-click setup.
 */
import path from 'node:path';
import { put } from '@vercel/blob';
import postgres from 'postgres';
import type { Sql } from '../src/lib/db';
import { bootstrap } from '../src/lib/db-bootstrap';

if (!process.env.VERCEL || !process.env.DATABASE_URL) process.exit(0);

const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const sql = client as unknown as Sql;
try {
  // One connection, so this session lock keeps two simultaneous builds from setting up the same database.
  await client`select pg_advisory_lock(hashtext('scholaros-bootstrap'))`;
  const done = await bootstrap(
    sql,
    path.resolve(import.meta.dirname, '..'),
    process.env,
    async (filename, bytes, contentType) =>
      (await put(filename, bytes, { access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true })).url,
  );
  console.log(done.length ? `Postgres mode:\n  ${done.join('\n  ')}` : 'Postgres mode: database up to date');
} catch (e) {
  console.error(`Postgres mode setup failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
