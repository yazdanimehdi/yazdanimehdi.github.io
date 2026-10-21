import { createHash } from 'node:crypto';
import { CV_JSON } from '../admin/paths';
import type { PostgresStore } from '../admin/postgres-store';
import { cvRenderRequest, renderCv } from '../cv-render';
import type { CvMetadata } from '../types';

/** Saves that change what the CV PDF shows (site.yml too: the author is bold in it). */
export const affectsCvPdf = (paths: string[]) =>
  paths.some(
    (p) =>
      p === 'config/cv.yml' ||
      p === 'config/cv-upload.yml' ||
      p === 'config/cv-styles.yml' ||
      p.startsWith('cv/themes/') ||
      p === 'config/site.yml' ||
      p.startsWith('src/content/publications/'),
  );

export function readCvMeta(content: string | undefined): CvMetadata | null {
  try {
    const meta = content ? JSON.parse(content) : null;
    // A seeded file has pdfPath null until the first PDF exists.
    return typeof meta?.pdfPath === 'string' ? (meta as CvMetadata) : null;
  } catch {
    return null;
  }
}

/**
 * Postgres mode: renders the stored CV with the public style through RenderCV, uploads it to Blob as
 * cv/cv-<hash>.pdf, records it in src/data/cv.json (which purges the CV page), then deletes the previous PDF.
 * `purgeFailed` carries the tags of the cv.json save whose cache purge failed. A failed cv.json save removes the PDF
 * this run uploaded, never one that already existed under the same name.
 */
export async function generateCvPdf(
  store: PostgresStore,
  now = new Date(),
): Promise<{ meta: CvMetadata; purgeFailed?: string[] }> {
  const [bytes, current] = await Promise.all([cvRenderRequest(store).then(renderCv), store.read(CV_JSON)]);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const upload = await store.putMedia(
    'site',
    `cv/cv-${hash}.pdf`,
    Buffer.from(bytes).toString('base64'),
    'application/pdf',
  );
  const meta: CvMetadata = { lastGenerated: now.toISOString(), pdfPath: upload.url, pdfSize: bytes.length };
  let saved;
  try {
    saved = await store.commit([{ path: CV_JSON, content: `${JSON.stringify(meta, null, 2)}\n` }], 'Generate CV PDF', {
      [CV_JSON]: current?.version ?? null,
    });
  } catch (e) {
    // Only a PDF this run created (`commit` set) is removed: a reused name is the PDF the site links to now.
    if (upload.commit)
      await store.deleteMedia(upload.url, '1').catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[cv-pdf] cleanup failed', err);
      });
    throw e;
  }
  const previous = readCvMeta(current?.content)?.pdfPath;
  // A page still cached with the old link (purge failed) must keep working, so the old PDF stays until the next run.
  if (!saved.warning && previous && previous !== upload.url && previous.startsWith('https://')) {
    // Best effort: a stray PDF in Blob costs a few kB; failing the save over it would cost more.
    await store.deleteMedia(previous, '1').catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[cv-pdf] could not delete the previous PDF', previous, e);
    });
  }
  return { meta, ...(saved.warning === 'cache-purge-failed' ? { purgeFailed: saved.tags ?? [] } : {}) };
}
