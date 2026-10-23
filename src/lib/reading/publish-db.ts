// Public vault notes as site content: their published copies kept in `documents`, like posts.
import { PostgresStore, type PostgresDeps } from '../admin/postgres-store';
import { ConflictError, type Change } from '../admin/store';
import type { Sql } from '../db';
import { getPapers, type Row } from './db';
import { COPY_DIRS, publishedCopy, type PublicNote } from './publish';
import { listHighlights } from './room-db';
import { linkKey } from './vault-links';

const iso = (v: unknown) => new Date(v as string | Date).toISOString();

/** Every public paper or free note, by id, with its paper and its public highlights. */
export async function publicNotes(sql: Sql): Promise<PublicNote[]> {
  const rows = await sql<Row>`
    select uid, kind, title, body, paper_id, public_slug, public_at, updated_at from vault_notes
    where public and kind in ('paper', 'free') order by id`;
  const ids = rows.flatMap((r) => (r.paper_id == null ? [] : [Number(r.paper_id)]));
  const papers = new Map((await getPapers(sql, ids)).map((p) => [p.id, p]));
  const highlights = (await listHighlights(sql, ids)).filter((h) => h.public);
  return rows.map((r) => {
    const p = r.paper_id == null ? undefined : papers.get(Number(r.paper_id));
    return {
      uid: r.uid as string,
      kind: r.kind as PublicNote['kind'],
      title: r.title as string,
      body: r.body as string,
      slug: r.public_slug as string,
      sharedAt: iso(r.public_at),
      updatedAt: iso(r.updated_at),
      ...(p && {
        paper: {
          title: p.title,
          authors: p.authors,
          url: p.url,
          arxiv: p.arxiv,
          doi: p.doi,
          publishedAt: p.publishedAt,
        },
        highlights: highlights
          .filter((h) => h.paperId === p.id)
          .map((h) => ({ pid: h.pid, quote: h.quote, comment: h.comment })),
      }),
    };
  });
}

const DIRS = Object.values(COPY_DIRS);
const ATTEMPTS = 3;

export const VAULT_AUTHOR = { name: 'Vault', email: 'scholaros-vault@users.noreply.github.com' };

/**
 * Brings `documents` under COPY_DIRS to exactly the copies publicNotes gives, in one commit of the differences. A
 * run that loses a race to another (ConflictError) starts over from fresh reads. `warning`: the copies are saved but
 * the CDN cache wasn't purged.
 */
export async function republish(
  sql: Sql,
  deps?: PostgresDeps,
): Promise<{ changed: number; warning?: 'cache-purge-failed' }> {
  const store = new PostgresStore(sql, VAULT_AUTHOR, deps);
  for (let attempt = 1; ; attempt++) {
    // `have` first: a commit landing after it makes this run's commit conflict, so stale notes can't be published.
    const have = await sql<{ path: string; content: string; version: number }>`
      select path, content, version from documents
      where path like any(${DIRS.map((d) => `${d}/%`)}::text[])`;
    const notes = await publicNotes(sql);
    const targets = new Map(notes.map((n) => [linkKey(n.title), n.uid]));
    const want = new Map(notes.map((n) => Object.values(publishedCopy(n, targets)) as [string, string]));
    const base: Record<string, string | null> = {};
    const changes: Change[] = [];
    for (const d of have) {
      const content = want.get(d.path) ?? null;
      if (content !== d.content) changes.push({ path: d.path, content });
      base[d.path] = String(d.version);
      want.delete(d.path);
    }
    for (const [path, content] of want) changes.push({ path, content });
    if (changes.length === 0) return { changed: 0 };
    try {
      const { warning } = await store.commit(changes, 'Vault: published copies', base);
      return { changed: changes.length, ...(warning === 'cache-purge-failed' && { warning }) };
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt === ATTEMPTS) throw e;
    }
  }
}
