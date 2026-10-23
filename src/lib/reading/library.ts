// The library (papers added by arXiv id or DOI) and what the reading-room routes share: ids, targets, outputs as
// shown, and the text-only runs that fetch a paper's text on Save, add and reopen.
import { z } from 'astro/zod';
import { HttpError } from '../admin/http';
import { findPaper } from '../admin/paper-complete';
import { paperLookupFor } from '../admin/papers';
import type { PostgresStore } from '../admin/postgres-store';
import { SourceError } from '../career/sources/http';
import type { Sql } from '../db';
import { STALE_MS, startRoomRun } from '../../workflows/reading-room';
import { missingTexts, setPaperState, upsertPapers } from './db';
import { normalizeArxiv, paperKey } from './match';
import { aiUse, getOutputs } from './room-db';
import type { ReadingPrefs } from './settings';
import type { Target } from './types';
import { ensurePaperNote, withTitles } from './vault-db';

/** New-style (2401.01234) or old-style (hep-th/9901001) arXiv id, with an optional version. */
const ARXIV_ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[a-z]{2})?\/\d{7})(v\d+)?$/i;
const DOI = /^10\.\d{4,9}\/\S+$/;

export function parseRef(ref: string): { arxiv: string } | { doi: string } | null {
  const s = ref.trim();
  const arxiv = s
    .replace(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\//i, '')
    .replace(/\.pdf$/i, '')
    .replace(/^arxiv:\s*/i, '');
  if (ARXIV_ID.test(arxiv)) return { arxiv: normalizeArxiv(arxiv) };
  const doi = s.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (!DOI.test(doi)) return null;
  const fromDoi = doi.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  return fromDoi && ARXIV_ID.test(fromDoi) ? { arxiv: normalizeArxiv(fromDoi) } : { doi };
}

/**
 * Finds the paper by arXiv id or DOI and saves it to the library (a dismissed paper comes back saved), with its vault
 * note.
 */
export async function addPaper(sql: Sql, store: PostgresStore, ref: string): Promise<{ id: number; added: boolean }> {
  const ids = parseRef(ref);
  if (!ids) throw new HttpError(400, 'Enter an arXiv id (2401.01234) or a DOI (10.1000/xyz)');
  const found = await findPaper({ title: '', authors: [], ...ids }, await paperLookupFor(store)).catch((e) => {
    throw e instanceof SourceError ? new HttpError(502, e.message) : e;
  });
  const r = found && (found.arxiv ?? found.crossref ?? Object.values(found)[0]);
  if (!r) throw new HttpError(404, 'No paper found for that id');
  const arxiv = r.arxiv ?? ('arxiv' in ids ? ids.arxiv : undefined);
  const doi = r.doi ?? ('doi' in ids ? ids.doi : undefined);
  const [saved] = await upsertPapers(sql, [
    {
      key: paperKey({ arxiv, doi, pmid: r.pmid })!, // ids gives an arXiv id or a DOI
      arxiv,
      doi,
      pmid: r.pmid,
      source: 'library',
      title: r.title,
      authors: r.authors,
      abstract: r.abstract,
      url: arxiv ? `https://arxiv.org/abs/${arxiv}` : `https://doi.org/${doi}`,
      publishedAt: r.date,
      categories: r.primaryClass ? [r.primaryClass] : [],
    },
  ]);
  await withTitles(sql, async (tx) => {
    await setPaperState(tx, saved.id, 'saved');
    await ensurePaperNote(tx, saved.id);
  });
  return saved;
}

/** A route's `[id]`: 1 to 9 digits, else the same 404 as a missing row. */
export function idParam(param: string | undefined): number {
  if (!/^\d{1,9}$/.test(param ?? '')) throw new HttpError(404, 'Not found');
  return Number(param);
}

const Id = z.number().int().min(1).max(999_999_999);
/** A body's `{ paper } | { notebook }`, spread into a route's strictObject; read with `targetOf`. */
export const TARGET = { paper: Id.optional(), notebook: Id.optional() };

export function targetOf(b: { paper?: number; notebook?: number }): Target {
  if ((b.paper === undefined) === (b.notebook === undefined))
    throw new HttpError(400, 'Give either `paper` or `notebook`');
  return b.paper !== undefined ? { paper: b.paper } : { notebook: b.notebook! };
}

/**
 * The target's outputs without their run ids; one still running after STALE_MS shows as failed, so a dead run
 * offers Try again (startRoomRun treats it as finished too).
 */
export async function shownOutputs(sql: Sql, target: Target, now = Date.now()) {
  const rows = await getOutputs(sql, target);
  return Object.fromEntries(
    Object.entries(rows).map(([kind, { runId: _, ...o }]) => [
      kind,
      o.status === 'running' && now - Date.parse(o.updatedAt) > STALE_MS
        ? { ...o, status: 'failed' as const, error: 'The run stopped before it finished.' }
        : o,
    ]),
  );
}

export const useToday = async (sql: Sql, prefs: ReadingPrefs) => ({
  today: await aiUse(sql, new Date().toISOString().slice(0, 10)),
  cap: prefs.roomAiCalls,
});

/**
 * Starts a text-only run for the target when any of `paperIds` lacks its text (never fetched, or a retryable error).
 * Errors are logged, never thrown: the request it rides on doesn't depend on it.
 */
export async function fetchMissingTexts(sql: Sql, target: Target, paperIds: number[]): Promise<void> {
  try {
    if ((await missingTexts(sql, paperIds)).length) await startRoomRun(sql, target, null);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reading] text run', e);
  }
}
