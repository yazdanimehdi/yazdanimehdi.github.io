// What a reading-room prompt is grounded on, shared by the summary/study-aid step and chat: the papers' passages (a
// scan alone goes as its PDF, a scan in a notebook as its abstract), the owner's profile, and the `mine` list.
import type { PostgresStore } from '../admin/postgres-store';
import type { Sql } from '../db';
import { getPapers, readReading } from './db';
import { profileText, readProfile } from './profile';
import { getPassages, readText } from './room-db';
import type { GroundPaper, Scan } from './room-prompts';
import { parseReadingPrefs, type ReadingPrefs } from './settings';

const MAX_PAPERS = 40; // as profileText lists
const NO_PROFILE = { areas: [], pubs: [] };

export interface Grounding {
  /** In `paperIds` order, every passage; cut them with pickPassages. */
  papers: GroundPaper[];
  /** A lone scan's PDF (its GroundPaper has no passages). */
  scan?: Scan;
  prefs: ReadingPrefs;
  profile: string;
  /** The owner's paper titles and research areas, as the profile lists them. */
  mine: string[];
  /** Papers with no passages and no scan: never fetched, or the fetch failed with a retryable `error`. */
  unread: { id: number; title: string; error: string | null }[];
}

/** `pdf: false`: a lone scan goes as its abstract too, never its PDF (a draft's copy check can't read a PDF). */
export async function loadGrounding(
  sql: Sql,
  store: PostgresStore,
  paperIds: number[],
  o: { pdf?: boolean } = {},
): Promise<Grounding> {
  const [papers, passages, texts, reading, owner] = await Promise.all([
    getPapers(sql, paperIds),
    getPassages(sql, paperIds),
    Promise.all(paperIds.map((id) => readText(sql, id))),
    readReading(sql),
    readProfile(store).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[reading] profile', e);
      return NO_PROFILE;
    }),
  ]);
  const prefs = parseReadingPrefs(reading.prefs);
  const listed = { ...owner, pubs: owner.pubs.slice(0, MAX_PAPERS) };
  const text = new Map(paperIds.map((id, i) => [id, texts[i]]));
  let scan: Scan | undefined;
  const unread: Grounding['unread'] = [];
  const grounded = papers.map((p): GroundPaper => {
    const t = text.get(p.id)!;
    const own = passages.filter((q) => q.paperId === p.id).map(({ pid, kind, body }) => ({ pid, kind, body }));
    if (t.source === 'scan' && t.pdf && !own.length) {
      if (papers.length === 1 && o.pdf !== false) scan = { paper: p.id, pages: t.pages ?? 1, pdf: t.pdf };
      else if (p.abstract) own.push({ pid: 'abs.1', kind: 'p', body: p.abstract });
    } else if (!own.length && (t.source === null || t.error !== null)) {
      unread.push({ id: p.id, title: p.title, error: t.error });
    }
    return { id: p.id, title: p.title, authors: p.authors, passages: own };
  });
  return {
    papers: grounded,
    scan,
    prefs,
    profile: profileText(prefs, listed),
    mine: [...listed.pubs.map((p) => p.title), ...listed.areas.map((a) => a.title)],
    unread,
  };
}

/** The '12:S2.p3' ids a reply may cite: the passages in the prompt, and a scan's pages. */
export function allowedCites(papers: GroundPaper[], scan?: Scan): Set<string> {
  const ids = papers.flatMap((g) => g.passages.filter((q) => !/^h\d$/.test(q.kind)).map((q) => `${g.id}:${q.pid}`));
  if (scan) for (let n = 1; n <= scan.pages; n++) ids.push(`${scan.paper}:page${n}`);
  return new Set(ids);
}
