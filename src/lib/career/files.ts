import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { del, put } from '@vercel/blob';
import { getSql } from '../db';
import { updatePosting } from './db';

/** What putCareerPdf calls outside the database; tests pass fakes. */
export interface BlobDeps {
  put(pathname: string, body: Buffer): Promise<{ url: string }>;
  del(url: string): Promise<void>;
}

const blobDeps: BlobDeps = {
  put: (pathname, body) =>
    put(pathname, body, { access: 'public', addRandomSuffix: true, contentType: 'application/pdf' }),
  // `astro dev` shares the live Blob store, and the dev branch can hold live URLs: never delete from it locally.
  del: async (url) => {
    // eslint-disable-next-line no-console
    if (import.meta.env?.DEV) return console.warn('[dev] Blob delete skipped', url);
    await del(url);
  },
};

/** A local check without Blob: CAREER_PDF_DIR writes the PDFs to that folder instead (never in production). */
const folderDeps = (dir: string): BlobDeps => ({
  put: async (pathname, body) => {
    const file = path.join(dir, `${pathname.replace(/\W+/g, '-')}-${Date.now()}.pdf`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, body);
    return { url: pathToFileURL(file).href };
  },
  del: async (url) => (url.startsWith('file:') ? rm(fileURLToPath(url), { force: true }) : undefined),
});

let testDeps: BlobDeps | null = null;

export function setBlobForTests(deps: BlobDeps | null): void {
  testDeps = deps;
}

function deps(): BlobDeps {
  const dir = process.env.CAREER_PDF_DIR;
  // Not `!VERCEL`: `astro dev` (and so dev:postgres) sets VERCEL=1 for the admin, the one place this is for.
  const local = dir && !process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production';
  return testDeps ?? (local ? folderDeps(dir) : blobDeps);
}

/**
 * Stores a posting's tailored PDF, saves its URL, then deletes the one it replaces.
 * ponytail: a public, unguessable Blob URL; switch to a private Blob store and an owner-only proxy route if tailored
 * CVs need to be truly private.
 */
export async function putCareerPdf(postingId: number, bytes: Uint8Array): Promise<string> {
  const sql = getSql();
  const d = deps();
  const [old] = await sql<{
    cv_pdf_url: string | null;
  }>`select cv_pdf_url from career_postings where id = ${postingId}`;
  const { url } = await d.put(`career/${postingId}.pdf`, Buffer.from(bytes));
  await updatePosting(sql, postingId, { cvPdfUrl: url });
  if (old?.cv_pdf_url && old.cv_pdf_url !== url) {
    // eslint-disable-next-line no-console
    await d.del(old.cv_pdf_url).catch((e) => console.error('[career] deleting the old PDF', e));
  }
  return url;
}

/**
 * Page objects in a PDF (`/Type /Page`, not the `/Pages` tree).
 * ponytail: a byte scan; pages inside compressed object streams are not seen (0), so a miss only skips the warning.
 */
export function pdfPages(pdf: Uint8Array): number {
  return (
    Buffer.from(pdf)
      .toString('latin1')
      .match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0
  );
}
