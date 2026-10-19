#!/usr/bin/env tsx
/**
 * pnpm db:setup [--force] — copies this repo's content into Postgres (DATABASE_URL) and its images into Vercel Blob
 * (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID with Vercel OIDC), rewriting image references to Blob URLs. Deployments
 * do this themselves on their first build (scripts/vercel-bootstrap.ts); run it locally after `vercel env pull`.
 */
import path from 'node:path';
import { put } from '@vercel/blob';
import postgres from 'postgres';
import type { Sql } from '../src/lib/db';
import { seedContent } from '../src/lib/db-bootstrap';
import { migrate } from '../src/lib/db-migrate';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: use the shell's environment
}
const ROOT = path.resolve(import.meta.dirname, '..');
if (!process.env.DATABASE_URL || !(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)) {
  console.error('DATABASE_URL and BLOB_READ_WRITE_TOKEN (or BLOB_STORE_ID) must be set (run `vercel env pull` first).');
  process.exit(1);
}
const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const sql = client as unknown as Sql;
try {
  await migrate(sql, path.join(ROOT, 'migrations'));
  const [{ count }] = await sql<{ count: number }>`select count(*)::int as count from documents`;
  if (count > 0 && !process.argv.includes('--force')) {
    console.error(
      `The database already has ${count} documents. Re-run with --force to overwrite them with the repo's files.`,
    );
    process.exitCode = 1;
  } else {
    const { documents, images, skipped } = await seedContent(
      sql,
      ROOT,
      async (filename, bytes, contentType) =>
        (await put(filename, bytes, { access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true }))
          .url,
    );
    console.log(`Documents: ${documents}`);
    console.log(`Images uploaded to Blob: ${images}`);
    if (skipped.length) {
      console.log(
        `Not copied (Postgres mode edits only slug-named files the admin allows):\n  ${skipped.join('\n  ')}`,
      );
    }
  }
} finally {
  await client.end();
}
