import fs from 'node:fs';
import path from 'node:path';
import { createAccount } from './admin/accounts';
import { MediaError, prepareUpload } from './admin/media';
import { loadAdminSettings } from './admin/settings';
import type { Sql } from './db';
import { migrate } from './db-migrate';
import { mediaFiles, rewriteReferences, seedFiles } from './db-seed';

/** Stores one image and returns its public URL (Vercel Blob in production, a stub in tests). */
export type Upload = (filename: string, bytes: Buffer, contentType: string) => Promise<string>;

export interface SeedResult {
  documents: number;
  images: number;
  skipped: string[];
}

/** Copies the repo's content into `documents` and its images through `upload`, rewriting image references. */
export async function seedContent(sql: Sql, root: string, upload: Upload): Promise<SeedResult> {
  const { mediaFolder, publicFolder } = loadAdminSettings(root);
  const urls = new Map<string, string>();
  const notUploaded: string[] = [];
  for (const file of mediaFiles(root, mediaFolder)) {
    const bytes = fs.readFileSync(path.join(root, file));
    try {
      const { filename, contentType } = prepareUpload(path.basename(file), bytes);
      const url = await upload(filename, bytes, contentType);
      await sql`insert into media (url, pathname, size, content_type)
        values (${url}, ${filename}, ${bytes.length}, ${contentType}) on conflict (url) do nothing`;
      urls.set(file, url);
    } catch (e) {
      if (!(e instanceof MediaError)) throw e;
      notUploaded.push(`${file} (${e.message})`);
    }
  }
  const { documents, skipped } = seedFiles(root);
  for (const file of documents) {
    const content = rewriteReferences(file, fs.readFileSync(path.join(root, file), 'utf8'), urls, {
      publicFolder,
      mediaFolder,
    });
    await sql.begin(async (tx) => {
      const [row] = await tx<{ version: number }>`
        insert into documents (path, content, updated_by) values (${file}, ${content}, 'seed')
        on conflict (path) do update set content = excluded.content, version = documents.version + 1,
          updated_at = now(), updated_by = 'seed'
        returning version`;
      await tx`insert into revisions (path, content, version, author) values (${file}, ${content}, ${row.version}, 'seed')`;
    });
  }
  return { documents: documents.length, images: urls.size, skipped: [...notUploaded, ...skipped] };
}

/** The first account's username: ADMIN_USERNAME, else the owner of the deployed GitHub repository. */
export function firstAdminUsername(env: Record<string, string | undefined>): string {
  return (env.ADMIN_USERNAME || env.VERCEL_GIT_REPO_OWNER || 'admin').toLowerCase();
}

/**
 * A fresh Postgres-mode deployment sets itself up during the build: tables, the repo's content (only into an empty
 * database, so later edits are never overwritten) and, while no account exists, one from ADMIN_PASSWORD.
 * Safe to run on every build.
 */
export async function bootstrap(
  sql: Sql,
  root: string,
  env: Record<string, string | undefined>,
  upload: Upload,
): Promise<string[]> {
  const done: string[] = [];
  const applied = await migrate(sql, path.join(root, 'migrations'));
  if (applied.length) done.push(`migrations applied: ${applied.join(', ')}`);

  const [{ count: docs }] = await sql<{ count: number }>`select count(*)::int as count from documents`;
  if (docs === 0) {
    const seeded = await seedContent(sql, root, upload);
    done.push(`content copied: ${seeded.documents} documents, ${seeded.images} images`);
    if (seeded.skipped.length) done.push(`not copied: ${seeded.skipped.join(', ')}`);
  }

  const [{ count: accounts }] = await sql<{ count: number }>`select count(*)::int as count from admin_users`;
  if (accounts === 0) {
    if (!env.ADMIN_PASSWORD) {
      done.push('no admin account: set ADMIN_PASSWORD and redeploy, or run `pnpm admin:create-user`');
    } else {
      const username = firstAdminUsername(env);
      try {
        await createAccount(sql, username, '', env.ADMIN_PASSWORD);
      } catch (e) {
        throw new Error(`ADMIN_PASSWORD / ADMIN_USERNAME: ${(e as Error).message}`, { cause: e });
      }
      done.push(`admin account created: ${username}`);
    }
  }
  return done;
}
