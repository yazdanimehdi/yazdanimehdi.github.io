// Papers people are talking about: Hugging Face trending, OpenAlex most-cited in the owner's topics, alphaXiv hot;
// and Bluesky mention counts for a paper.
import type { Lookup } from '../../admin/paper-complete';
import { list, obj, parseOpenAlex, str } from '../../admin/paper-sources';
import { normalizeArxiv, paperKey } from '../match';
import type { ReadingPrefs } from '../settings';
import type { NewPaper, Paper, Signals } from '../types';
import { unique } from './new';

export const TRACTION_SOURCES = ['huggingface', 'openalex', 'alphaxiv'] as const;

const OPENALEX = 'https://api.openalex.org';
const WORK_FIELDS =
  'id,doi,display_name,authorships,publication_year,publication_date,cited_by_count,abstract_inverted_index,primary_location,best_oa_location,type';
const LEVELS = ['field', 'subfield'] as const;
const q = encodeURIComponent;
const date = (iso: string | undefined) => iso?.slice(0, 10);
const num = (v: unknown) => Number(v) || 0;

/** `day` (YYYY-MM-DD) minus `n` days. */
const daysBefore = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const sixtyDaysBefore = (d: string) => daysBefore(d, 60);
/** OpenAlex types that are papers: no datasets, dissertations, paratext (journal records) or software. */
const PAPER_TYPES = 'article|preprint|review';

/** An arXiv paper with one source's signals. */
function arxivPaper(
  id: string | undefined,
  source: string,
  fields: Pick<NewPaper, 'title' | 'authors' | 'abstract' | 'publishedAt' | 'signals'>,
): NewPaper[] {
  if (!id || !fields.title) return [];
  const arxiv = normalizeArxiv(id);
  return [{ key: `arxiv:${arxiv}`, arxiv, source, url: `https://arxiv.org/abs/${arxiv}`, categories: [], ...fields }];
}

export function parseHfDaily(json: unknown): NewPaper[] {
  return list(json).flatMap((raw) => {
    const item = obj(raw);
    const p = obj(item.paper);
    // A paper never submitted to the daily list is counted from its own date.
    const since = str(p.submittedOnDailyAt) ?? str(p.publishedAt);
    if (!since) return [];
    return arxivPaper(str(p.id), 'huggingface', {
      title: str(p.title) ?? str(item.title) ?? '',
      authors: list(p.authors).flatMap((a) => str(obj(a).name) ?? []),
      abstract: str(p.summary),
      publishedAt: date(str(p.publishedAt)),
      signals: { huggingface: { upvotes: num(p.upvotes), comments: num(item.numComments), since } },
    });
  });
}

export function parseOpenAlexTraction(json: unknown): NewPaper[] {
  return list(obj(json).results).flatMap((w) => {
    const [r] = parseOpenAlex({ results: [w] });
    const key = r && paperKey(r);
    const since = str(obj(w).publication_date);
    if (!key || !since) return [];
    const arxiv = key.startsWith('arxiv:') ? key.slice('arxiv:'.length) : undefined;
    const { doi, title, authors, abstract } = r;
    return [
      {
        key,
        arxiv,
        doi,
        source: 'openalex',
        title,
        authors,
        abstract,
        url: arxiv ? `https://arxiv.org/abs/${arxiv}` : `https://doi.org/${doi}`,
        publishedAt: since,
        categories: [],
        signals: { openalex: { citations: num(obj(w).cited_by_count), since } },
      },
    ];
  });
}

export function parseAlphaxiv(json: unknown): NewPaper[] {
  return list(obj(json).papers).flatMap((raw) => {
    const p = obj(raw);
    const metrics = obj(p.metrics);
    return arxivPaper(str(p.universal_paper_id), 'alphaxiv', {
      title: str(p.title) ?? '',
      authors: list(p.authors).flatMap((a) => str(a) ?? []),
      abstract: str(p.abstract),
      publishedAt: date(str(p.publication_date)),
      signals: {
        alphaxiv: { visits: num(obj(metrics.visits_count).last_7_days), votes: num(metrics.public_total_votes) },
      },
    });
  });
}

export async function fetchTraction(
  id: (typeof TRACTION_SOURCES)[number],
  prefs: ReadingPrefs,
  get: Lookup['get'],
  day: string,
  openAlexKey?: string,
): Promise<NewPaper[]> {
  if (id === 'huggingface') {
    // Each of the 7 days up to `day`, by upvotes: `sort=trending` mixes in papers years old and misses some of the
    // week's most upvoted, and `week=` rejects ISO week 53.
    const week = Array.from({ length: 7 }, (_, i) => daysBefore(day, i));
    const papers: NewPaper[] = [];
    for (const d of week)
      papers.push(...parseHfDaily(JSON.parse(await get(`https://huggingface.co/api/daily_papers?date=${d}&limit=50`))));
    const from = Date.parse(`${week[6]}T00:00:00Z`);
    return unique(papers.filter((p) => Date.parse(p.signals!.huggingface!.since) >= from));
  }
  if (id === 'alphaxiv')
    return unique(
      parseAlphaxiv(
        JSON.parse(
          await get('https://api.alphaxiv.org/papers/v3/feed?pageNum=0&pageSize=50&sort=Hot&interval=7%20Days'),
        ),
      ),
    );
  const papers: NewPaper[] = [];
  const from = sixtyDaysBefore(day);
  const key = openAlexKey ? `&api_key=${q(openAlexKey)}` : '';
  for (const level of LEVELS) {
    const ids = prefs.sources.openalex.topics.flatMap((t) => (t.id.startsWith(`${level}s/`) ? t.id.split('/')[1] : []));
    if (!ids.length) continue;
    const filter = `primary_topic.${level}.id:${ids.join('|')},from_publication_date:${from},type:${PAPER_TYPES},is_paratext:false`;
    const url = `${OPENALEX}/works?filter=${filter}&sort=cited_by_count:desc&per_page=50&select=${WORK_FIELDS}${key}`;
    // The filter asks for this already; a work that slips through anyway is dropped here.
    const results = list(obj(JSON.parse(await get(url))).results).filter((w) => {
      const { type, publication_date: date } = obj(w);
      return PAPER_TYPES.split('|').includes(str(type) ?? '') && (str(date) ?? '') >= from;
    });
    papers.push(...parseOpenAlexTraction({ results }));
  }
  return unique(papers);
}

/** Bluesky posts in the last 60 days linking the paper's arXiv page, else naming its DOI; null with neither. */
export async function blueskyCount(
  get: Lookup['get'],
  p: Pick<Paper, 'arxiv' | 'doi'>,
  day: string,
): Promise<Signals['bluesky'] | null> {
  const term = p.arxiv ? `arxiv.org/abs/${p.arxiv}` : p.doi;
  if (!term) return null;
  const json = JSON.parse(
    await get(
      `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${q(term)}&limit=100&since=${sixtyDaysBefore(day)}T00:00:00Z`,
    ),
  );
  const posts = list(obj(json).posts).length;
  return { posts, capped: posts >= 100 };
}

/** OpenAlex fields, then subfields, matching `query`; at most 10. */
export async function searchTopics(
  get: Lookup['get'],
  query: string,
  key?: string,
): Promise<{ id: string; name: string; level: 'field' | 'subfield' }[]> {
  const found: { id: string; name: string; level: 'field' | 'subfield' }[] = [];
  for (const level of LEVELS) {
    const url = `${OPENALEX}/${level}s?search=${q(query)}&select=id,display_name${key ? `&api_key=${q(key)}` : ''}`;
    for (const raw of list(obj(JSON.parse(await get(url))).results)) {
      const id = str(obj(raw).id)?.replace(/^https:\/\/openalex\.org\//, '');
      const name = str(obj(raw).display_name);
      if (id && name && new RegExp(`^${level}s/\\d+$`).test(id)) found.push({ id, name, level });
    }
  }
  return found.slice(0, 10);
}
