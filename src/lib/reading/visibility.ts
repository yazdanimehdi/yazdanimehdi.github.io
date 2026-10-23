// What the owner sees of a note's public side, and the republish every vault write runs.
import { HttpError } from '../admin/http';
import { isPageOn } from '../config';
import type { Sql } from '../db';
import { republish } from './publish-db';
import { listHighlights } from './room-db';
import type { Highlight, VaultNote } from './types';

export interface Visibility {
  noteId: number | null;
  public: boolean;
  url: string | null;
  /** Whether the note's page (Readings or Notes) is on. */
  pageOn: boolean;
  chat: boolean;
  /** A paper's public and total highlights. */
  highlights?: { on: number; all: number };
}

/** A null note is a paper's that doesn't exist yet. */
export function visibilityOf(note: VaultNote | null, highlights?: { on: number; all: number }): Visibility {
  const page = !note || note.kind === 'paper' ? '/readings' : '/notes';
  return {
    noteId: note?.id ?? null,
    public: note?.public ?? false,
    url: note?.public && note.publicSlug ? `${page}/${note.publicSlug}/` : null,
    pageOn: isPageOn(page),
    chat: note?.kind === 'chat',
    ...(highlights && { highlights }),
  };
}

export const highlightCounts = (hs: Highlight[]) => ({ on: hs.filter((h) => h.public).length, all: hs.length });

/** visibilityOf, with the paper's highlight counts for a paper's note (`paperId` when there is no note yet). */
export async function noteVisibility(sql: Sql, note: VaultNote | null, paperId = note?.paperId): Promise<Visibility> {
  return visibilityOf(note, paperId == null ? undefined : highlightCounts(await listHighlights(sql, [paperId])));
}

let testRepublish: typeof republish | null = null;

/** Tests swap the republish it runs (as setApplySandboxForTests does); production code never calls this. */
export function setRepublishForTests(fn: typeof republish | null): void {
  testRepublish = fn;
}

const STALE = 'Your public pages were saved but the cache didn’t refresh. Publish again to retry.';

/**
 * "Publish again": republish, its failure logged and a 502 with a sentence; `publishWarning` when the copies are
 * saved but the cache wasn't refreshed.
 */
export async function publishAgain(sql: Sql): Promise<{ changed: number; publishWarning?: string }> {
  try {
    const { changed, warning } = await (testRepublish ?? republish)(sql);
    return { changed, ...(warning && { publishWarning: STALE }) };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reading] republish', e);
    throw new HttpError(502, `Your public pages weren’t updated: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Runs republish; a failure is logged and returned as a sentence, never thrown. */
export async function afterVaultWrite(sql: Sql): Promise<{ publishWarning?: string }> {
  try {
    const { publishWarning } = await publishAgain(sql);
    return publishWarning ? { publishWarning } : {};
  } catch (e) {
    return { publishWarning: (e as HttpError).message };
  }
}
