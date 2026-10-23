// What the owner sees of a note's public side, and the republish every vault write runs.
import { readConfig } from '../admin/content';
import { getStore } from '../admin/get-store';
import { HttpError } from '../admin/http';
import { isPageOn } from '../config';
import type { Sql } from '../db';
import type { SiteConfig } from '../types';
import { VAULT_AUTHOR, republish } from './publish-db';
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

type Pages = SiteConfig['pages'];

/**
 * site.yml's page switches, read through the store: admin routes run outside the request context that
 * getSiteConfig() reads in Postgres mode.
 */
export async function sitePages(): Promise<Pages> {
  const { data } = await readConfig(getStore(VAULT_AUTHOR), 'site');
  return data.pages as Pages;
}

/** A null note is one that doesn't exist yet: a paper's, unless `kind` says otherwise. */
export function visibilityOf(
  note: VaultNote | null,
  pages: Pages,
  highlights?: { on: number; all: number },
  kind = note?.kind ?? 'paper',
): Visibility {
  const page = kind === 'paper' ? '/readings' : '/notes';
  return {
    noteId: note?.id ?? null,
    public: note?.public ?? false,
    url: note?.public && note.publicSlug ? `${page}/${note.publicSlug}/` : null,
    pageOn: isPageOn(page, { pages }),
    chat: note?.kind === 'chat',
    ...(highlights && { highlights }),
  };
}

export const highlightCounts = (hs: Highlight[]) => ({ on: hs.filter((h) => h.public).length, all: hs.length });

/** visibilityOf, with the paper's highlight counts for a paper's note (`paperId` when there is no note yet). */
export async function noteVisibility(sql: Sql, note: VaultNote | null, paperId = note?.paperId): Promise<Visibility> {
  const [pages, hs] = await Promise.all([sitePages(), paperId == null ? null : listHighlights(sql, [paperId])]);
  return visibilityOf(note, pages, hs ? highlightCounts(hs) : undefined);
}

let testRepublish: typeof republish | null = null;

/** Tests swap the republish it runs (as setApplySandboxForTests does); production code never calls this. */
export function setRepublishForTests(fn: typeof republish | null): void {
  testRepublish = fn;
}

const STALE = 'Saved. The public pages’ cache didn’t refresh; Publish again to retry.';
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Republish, its failure logged and thrown; `publishWarning` when the copies are saved but the cache wasn't refreshed. */
async function run(sql: Sql): Promise<{ changed: number; publishWarning?: string }> {
  try {
    const { changed, warning } = await (testRepublish ?? republish)(sql);
    return { changed, ...(warning && { publishWarning: STALE }) };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reading] republish', e);
    throw e;
  }
}

/** "Publish again": run, a failure answered as a 502 with a sentence. */
export async function publishAgain(sql: Sql): Promise<{ changed: number; publishWarning?: string }> {
  try {
    return await run(sql);
  } catch (e) {
    throw new HttpError(502, `Your public pages weren’t updated: ${why(e)}`);
  }
}

/** Runs republish after a save; a failure is returned as a sentence, never thrown. */
export async function afterVaultWrite(sql: Sql): Promise<{ publishWarning?: string }> {
  try {
    const { publishWarning } = await run(sql);
    return publishWarning ? { publishWarning } : {};
  } catch (e) {
    return { publishWarning: `Saved, but the public copy didn't update: ${why(e)}` };
  }
}
