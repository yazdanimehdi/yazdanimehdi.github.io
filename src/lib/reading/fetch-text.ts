// A paper's full text: arXiv's HTML, then its PDF, then the abstract. A 404 moves on to the next source; any other
// failure is stored as a retryable `error` and fetched again later, never recorded as abstract-only.
import { readConfig } from '../admin/content';
import { getStore } from '../admin/get-store';
import { HttpError } from '../admin/http';
import { getBytes, getText, SourceError } from '../career/sources/http';
import type { Sql } from '../db';
import { getPapers, saveText, type Row } from './db';
import { readText, replacePassages, savePassages } from './room-db';
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

/** The text row's version (its fetched_at), null without a row. */
async function version(sql: Sql, paperId: number): Promise<string | null> {
  const [r] = await sql<Row>`select fetched_at::text as at from reading_texts where paper_id = ${paperId}`;
  return (r?.at as string | undefined) ?? null;
}

/**
 * Stores a fetch's result (and its passages, when given) only while the text row is still at version `seen`: an
 * owner's upload, or another run, that wrote meanwhile wins. The paper's row lock orders it with storeUpload. False
 * when it lost.
 */
async function storeFetched(
  sql: Sql,
  paperId: number,
  seen: string | null,
  text: Parameters<typeof saveText>[2],
  passages?: Passage[],
): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`select id from reading_papers where id = ${paperId} for update`;
    if ((await version(tx, paperId)) !== seen) return false;
    if (passages) await replacePassages(tx, paperId, passages);
    await saveText(tx, paperId, text);
    return true;
  });
}

/** The abstract as passage 'abs.1' (none without an abstract), with why there is no more. */
async function useAbstract(sql: Sql, p: Paper, note: string, seen: string | null): Promise<void> {
  const passages: Passage[] = p.abstract ? [{ pid: 'abs.1', kind: 'p', body: p.abstract }] : [];
  await storeFetched(sql, p.id, seen, { source: 'abstract', note }, passages);
}

/** The paper has its text, from this fetch or from whoever wrote first. */
const DONE = { next: null, ok: true };

/**
 * The arXiv source to fetch next, or null when there is nothing to fetch: the paper has passages, or its text is the
 * abstract, a scan or an upload. A stored HTML body without passages (Project 1's) is split here, and a paper not on
 * arXiv gets its abstract, both without a fetch.
 */
export async function textNeedFor(sql: Sql, paperId: number): Promise<TextStep | null> {
  const seen = await version(sql, paperId);
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
    await useAbstract(sql, p, 'This paper is not on arXiv', seen);
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
 * gives `{ next: null, ok: false }`. Never throws on a fetch. Nothing is fetched when the paper needs no text, and
 * nothing is stored over a text written while this fetch ran (an upload): both give `ok`.
 */
export async function fetchArxivText(
  sql: Sql,
  paperId: number,
  step: TextStep,
): Promise<{ next: TextStep | null; ok: boolean }> {
  // Read before the need check, so a write after it shows as a new version.
  const seen = await version(sql, paperId);
  const [p] = await getPapers(sql, [paperId]);
  if (!p?.arxiv) return { next: null, ok: false };
  if (!(await textNeedFor(sql, paperId))) return DONE;
  const headers = { 'User-Agent': await userAgent() };
  const source = step === 'html' ? 'arxiv-html' : 'arxiv-pdf';
  const store = (text: Parameters<typeof saveText>[2], passages?: Passage[]) =>
    storeFetched(sql, paperId, seen, text, passages);
  const abstract = async (note: string) => (await useAbstract(sql, p, note, seen), DONE);
  /** A failure, unless someone else wrote the text meanwhile. */
  const failed = async (error: string, next: TextStep | null) =>
    (await store({ source, error })) ? { next, ok: false } : DONE;
  try {
    if (step === 'html') {
      const body = await getText(`https://arxiv.org/html/${p.arxiv}`, { maxBytes: HTML_MAX, headers });
      const passages = splitArxivHtml(body);
      if (!hasParagraph(passages)) return await failed('404', 'pdf');
      await store({ source, body }, passages);
      return DONE;
    }
    const bytes = await getBytes(`https://arxiv.org/pdf/${p.arxiv}`, { maxBytes: PDF_MAX, timeoutMs: 60_000, headers });
    let pages;
    try {
      pages = await pdfLines(bytes);
    } catch {
      return await abstract("arXiv's PDF could not be read");
    }
    const passages = splitPdfPages(pages);
    if (!isScan(passages, pages.length)) await store({ source, pages: pages.length }, passages);
    else if (bytes.byteLength <= SCAN_MAX) await store({ source: 'scan', pdf: bytes, pages: pages.length });
    else return await abstract("arXiv's PDF has no text layer and is too big for the AI to read");
    return DONE;
  } catch (e) {
    if (e instanceof SourceError && e.status === 404)
      return step === 'pdf' ? await abstract('arXiv has no HTML or PDF version') : await failed('404', 'pdf');
    const message = (e as Error).message;
    if (step === 'pdf' && e instanceof SourceError && message.endsWith(`response is over ${PDF_MAX} bytes`))
      return await abstract("arXiv's PDF is over 30 MB");
    return await failed(message, null);
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
  await sql.begin(async (tx) => {
    // The lock storeFetched takes: a fetch that read the text before this never stores over it.
    await tx`select id from reading_papers where id = ${paperId} for update`;
    await replacePassages(tx, paperId, scan ? [] : passages);
    await saveText(tx, paperId, { source: scan ? 'scan' : 'upload', pdf: scan ? bytes : null, pages: pages.length });
  });
  return { source: scan ? 'scan' : 'upload', error: null, note: null, pages: pages.length };
}
