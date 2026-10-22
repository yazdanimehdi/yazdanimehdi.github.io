// A paper's full text: arXiv's HTML, then its PDF, then the abstract. A 404 moves on to the next source; any other
// failure is stored as a retryable `error` and fetched again later, never recorded as abstract-only.
import { readConfig } from '../admin/content';
import { getStore } from '../admin/get-store';
import { HttpError } from '../admin/http';
import { getBytes, getText, SourceError } from '../career/sources/http';
import type { Sql } from '../db';
import { getPapers, saveText } from './db';
import { readText, savePassages } from './room-db';
import { isScan, pdfLines, splitArxivHtml, splitPdfPages } from './text';
import type { Paper, Passage, TextState } from './types';

export type TextStep = 'html' | 'pdf';

const MB = 1024 * 1024;
const HTML_MAX = 10 * MB;
const PDF_MAX = 30 * MB;
const SCAN_MAX = 4 * MB;
/** Reads the site config only. */
const READER = { name: 'ScholarOS reading', email: 'scholaros-reading@users.noreply.github.com' };

const hasParagraph = (passages: Passage[]) => passages.some((p) => p.kind === 'p');

/** The abstract as passage 'abs.1' (none without an abstract), with why there is no more. */
async function useAbstract(sql: Sql, p: Paper, note: string): Promise<void> {
  await savePassages(sql, p.id, p.abstract ? [{ pid: 'abs.1', kind: 'p', body: p.abstract }] : []);
  await saveText(sql, p.id, { source: 'abstract', note });
}

/**
 * The arXiv source to fetch next, or null when there is nothing to fetch: the paper has passages, or its text is the
 * abstract, a scan or an upload. A stored HTML body without passages (Project 1's) is split here, and a paper not on
 * arXiv gets its abstract, both without a fetch.
 */
export async function textNeedFor(sql: Sql, paperId: number): Promise<TextStep | null> {
  const t = await readText(sql, paperId);
  if (t.passages || t.source === 'abstract' || t.source === 'scan' || t.source === 'upload') return null;
  if (t.source === 'arxiv-html' && t.body !== null) {
    const passages = splitArxivHtml(t.body);
    if (!hasParagraph(passages)) return 'pdf';
    await savePassages(sql, paperId, passages);
    return null;
  }
  const [p] = await getPapers(sql, [paperId]);
  if (!p) return null;
  if (!p.arxiv) {
    await useAbstract(sql, p, 'This paper is not on arXiv');
    return null;
  }
  return t.source === 'arxiv-pdf' || (t.source === 'arxiv-html' && t.error === '404') ? 'pdf' : 'html';
}

async function userAgent(): Promise<string> {
  const site = await readConfig(getStore(READER), 'site');
  const siteUrl = typeof site.data.siteUrl === 'string' ? site.data.siteUrl : '';
  return siteUrl ? `ScholarOS reading (+${siteUrl})` : 'ScholarOS reading';
}

/**
 * Fetches one arXiv source and stores what it gives. `ok`: the paper has its text (or, past the PDF, the abstract
 * with a note). `next`: the source to try after a 404. Any other failure stores the error, touches no passages, and
 * gives `{ next: null, ok: false }`. Never throws on a fetch.
 */
export async function fetchArxivText(
  sql: Sql,
  paperId: number,
  step: TextStep,
): Promise<{ next: TextStep | null; ok: boolean }> {
  const [p] = await getPapers(sql, [paperId]);
  if (!p?.arxiv) return { next: null, ok: false };
  const headers = { 'User-Agent': await userAgent() };
  const source = step === 'html' ? 'arxiv-html' : 'arxiv-pdf';
  try {
    if (step === 'html') {
      const body = await getText(`https://arxiv.org/html/${p.arxiv}`, { maxBytes: HTML_MAX, headers });
      const passages = splitArxivHtml(body);
      if (!hasParagraph(passages)) {
        await saveText(sql, paperId, { source, error: '404' });
        return { next: 'pdf', ok: false };
      }
      await savePassages(sql, paperId, passages);
      await saveText(sql, paperId, { source, body });
      return { next: null, ok: true };
    }
    const bytes = await getBytes(`https://arxiv.org/pdf/${p.arxiv}`, { maxBytes: PDF_MAX, timeoutMs: 60_000, headers });
    let pages;
    try {
      pages = await pdfLines(bytes);
    } catch {
      await useAbstract(sql, p, "arXiv's PDF could not be read");
      return { next: null, ok: true };
    }
    const passages = splitPdfPages(pages);
    if (!isScan(passages, pages.length)) {
      await savePassages(sql, paperId, passages);
      await saveText(sql, paperId, { source, pages: pages.length });
    } else if (bytes.byteLength <= SCAN_MAX) {
      await saveText(sql, paperId, { source: 'scan', pdf: bytes, pages: pages.length });
    } else {
      await useAbstract(sql, p, "arXiv's PDF has no text layer and is too big for the AI to read");
    }
    return { next: null, ok: true };
  } catch (e) {
    if (e instanceof SourceError && e.status === 404) {
      if (step === 'pdf') {
        await useAbstract(sql, p, 'arXiv has no HTML or PDF version');
        return { next: null, ok: true };
      }
      await saveText(sql, paperId, { source, error: '404' });
      return { next: 'pdf', ok: false };
    }
    const message = (e as Error).message;
    if (step === 'pdf' && e instanceof SourceError && message.endsWith(`response is over ${PDF_MAX} bytes`)) {
      await useAbstract(sql, p, "arXiv's PDF is over 30 MB");
      return { next: null, ok: true };
    }
    await saveText(sql, paperId, { source, error: message });
    return { next: null, ok: false };
  }
}

/** The owner's PDF as the paper's text (a scan kept for the AI). Callers check the 4 MB limit first. */
export async function storeUpload(sql: Sql, paperId: number, bytes: Uint8Array): Promise<TextState> {
  let pages;
  try {
    pages = await pdfLines(bytes);
  } catch {
    throw new HttpError(400, 'That file is not a PDF this can read');
  }
  const passages = splitPdfPages(pages);
  const scan = isScan(passages, pages.length);
  await savePassages(sql, paperId, scan ? [] : passages);
  await saveText(sql, paperId, { source: scan ? 'scan' : 'upload', pdf: scan ? bytes : null, pages: pages.length });
  return { source: scan ? 'scan' : 'upload', error: null, note: null, pages: pages.length };
}
