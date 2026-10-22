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
  const { arxiv, doi, pmid, source, title, authors, abstract } = r;
  return [{ key, arxiv, doi, pmid, source, title, authors, abstract, url, categories }];
}

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
    return parseArxivRss(xml)
      .filter((r) => r.announce === 'new' || r.announce === 'cross')
      .flatMap((r) => toNew(r, `https://arxiv.org/abs/${r.arxiv}`, r.categories));
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
    return parsePubmed(xml).flatMap((r) => (r.pmid ? toNew(r, `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`, []) : []));
  }
  const papers: NewPaper[] = [];
  for (const category of prefs.sources[id].categories) {
    for (let page = 0, cursor = 0; page < MAX_PAGES; page++, cursor += PAGE) {
      const json = JSON.parse(
        await get(`https://api.biorxiv.org/details/${id}/${from}/${day}/${cursor}?category=${q(category)}`),
      );
      papers.push(...parseBiorxiv(json, id).flatMap((r) => toNew(r, `https://doi.org/${r.doi}`, [category])));
      // The API sends `total` as a string, and none at all when nothing matched.
      if (!(cursor + PAGE < Number(json?.messages?.[0]?.total))) break;
    }
  }
  return papers;
}
