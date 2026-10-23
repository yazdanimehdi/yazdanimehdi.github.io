// The day's new papers from arXiv (RSS), bioRxiv/medRxiv (details API) and PubMed (E-utilities).
import type { Lookup } from '../../admin/paper-complete';
import { parseArxivRss, parseBiorxiv, parsePubmed, type PaperRecord } from '../../admin/paper-sources';
import { paperKey } from '../match';
import type { ReadingPrefs } from '../settings';
import type { NewPaper } from '../types';

export const NEW_SOURCES = ['arxiv', 'biorxiv', 'medrxiv', 'pubmed'] as const;

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const PAGE = 30;
const MAX_PAGES = 10;
const q = encodeURIComponent;

/** `day` (YYYY-MM-DD) minus two days. */
const twoDaysBefore = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);

function toNew(r: PaperRecord, url: string, categories: string[]): NewPaper[] {
  const key = paperKey(r);
  if (!key) return [];
  const { arxiv, doi, pmid, source, title, authors, abstract, date: publishedAt } = r;
  return [{ key, arxiv, doi, pmid, source, title, authors, abstract, url, publishedAt, categories }];
}

/** One paper per key: the contract later steps rely on (the last record for a key wins). */
export const unique = (papers: NewPaper[]) => [...new Map(papers.map((p) => [p.key, p])).values()];

export async function fetchNew(
  id: (typeof NEW_SOURCES)[number],
  prefs: ReadingPrefs,
  get: Lookup['get'],
  day: string,
): Promise<NewPaper[]> {
  const from = twoDaysBefore(day);
  if (id === 'arxiv') {
    const { categories } = prefs.sources.arxiv;
    if (!categories.length) return [];
    const xml = await get(`https://rss.arxiv.org/rss/${categories.join('+')}`, 'application/rss+xml');
    return unique(
      parseArxivRss(xml)
        .filter((r) => r.announce === 'new' || r.announce === 'cross')
        .flatMap((r) => toNew(r, `https://arxiv.org/abs/${r.arxiv}`, r.categories)),
    );
  }
  if (id === 'pubmed') {
    const term = prefs.sources.pubmed.query.trim();
    if (!term) return [];
    const dates = `mindate=${from.replaceAll('-', '/')}&maxdate=${day.replaceAll('-', '/')}`;
    const search = JSON.parse(
      await get(`${EUTILS}esearch.fcgi?db=pubmed&retmode=json&retmax=200&datetype=edat&${dates}&term=${q(term)}`),
    );
    const ids: unknown[] = search?.esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    const xml = await get(`${EUTILS}efetch.fcgi?db=pubmed&retmode=xml&id=${ids.map((i) => q(String(i))).join(',')}`);
    return unique(
      parsePubmed(xml).flatMap((r) => (r.pmid ? toNew(r, `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`, []) : [])),
    );
  }
  const papers: NewPaper[] = [];
  for (const category of prefs.sources[id].categories) {
    // `details` lists a paper once per version posted in the window: keep its latest version.
    const latest = new Map<unknown, { version?: unknown }>();
    for (let page = 0, cursor = 0; page < MAX_PAGES; page++, cursor += PAGE) {
      const json = JSON.parse(
        await get(`https://api.biorxiv.org/details/${id}/${from}/${day}/${cursor}?category=${q(category)}`),
      );
      for (const c of Array.isArray(json?.collection) ? json.collection : []) {
        const seen = latest.get(c?.doi);
        if (!seen || Number(c?.version) > Number(seen.version)) latest.set(c?.doi, c);
      }
      // The API sends `total` as a string, and none at all when nothing matched.
      if (!(cursor + PAGE < Number(json?.messages?.[0]?.total))) break;
    }
    const records = parseBiorxiv({ collection: [...latest.values()] }, id);
    papers.push(...records.flatMap((r) => toNew(r, `https://doi.org/${r.doi}`, [category])));
  }
  return unique(papers);
}
