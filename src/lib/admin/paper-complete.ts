// Finds a paper's own record on arXiv, bioRxiv/medRxiv, Crossref, PubMed and OpenAlex, and merges its fields by source quality.
import { getText, SourceError } from '../career/sources/http';
import {
  arxivBibtex,
  parseArxivFeed,
  parseBiorxiv,
  parseCrossrefWorks,
  parseOpenAlex,
  parsePubmed,
  type PaperRecord,
} from './paper-sources';
import { generateId, inferType, normalizeTitle } from './papers';

/** All network a completion needs; tests fake it by URL. `accept` defaults to JSON/Atom. */
export interface Lookup {
  get(url: string, accept?: string): Promise<string>;
}

export const COMPLETABLE = [
  'title',
  'authors',
  'venue',
  'year',
  'type',
  'doi',
  'arxiv',
  'url',
  'pdf',
  'abstract',
  'bibtex',
] as const;
export type Completable = (typeof COMPLETABLE)[number];
export type Completed = Partial<Record<Completable, unknown>>;
export type Source = PaperRecord['source'];
/** The records found for one paper, by source. */
export type Found = Partial<Record<Source, PaperRecord>>;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Folded surname of each name: the last word, or the part before the comma in "Last, F.". */
export function surnames(authors: string[]): Set<string> {
  return new Set(
    authors.map((a) => fold(a.includes(',') ? a.split(',')[0] : (a.trim().split(/\s+/).pop() ?? ''))).filter(Boolean),
  );
}

/** True when the lists share at least one surname. */
export function sameAuthors(a: string[], b: string[]): boolean {
  const theirs = surnames(b);
  return [...surnames(a)].some((s) => theirs.has(s));
}

type Ref = { title: string; authors: string[] };

/** The confident title hit for `ref` (folded titles equal and a shared surname), a published version first. */
function best(records: PaperRecord[], ref: Ref): PaperRecord | undefined {
  const title = normalizeTitle(ref.title);
  const hits = records.filter((r) => title && normalizeTitle(r.title) === title && sameAuthors(ref.authors, r.authors));
  return hits.find((r) => r.type !== 'preprint') ?? hits[0];
}

const ARXIV = 'https://export.arxiv.org/api/query?';
const CROSSREF = 'https://api.crossref.org/works';
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const OPENALEX = 'https://api.openalex.org/works';
const q = encodeURIComponent;

function json(s: string | undefined): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

/** An arXiv id from the entry, or from an arxiv.org /abs/ or /pdf/ link, without its version. */
function arxivId(pub: { arxiv?: string; url?: string; pdf?: string }): string | undefined {
  const link = [pub.url, pub.pdf]
    .map((u) => u?.match(/arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?(?:[?#]|$)/i)?.[1])
    .find(Boolean);
  return (pub.arxiv?.trim().replace(/^arxiv:/i, '') || link)?.replace(/v\d+$/, '');
}

/** Finds the paper's records: by arXiv id, else DOI, else a title search; then bioRxiv/medRxiv, PubMed and OpenAlex. Null when nothing matches. */
export async function findPaper(
  pub: { title: string; authors: string[]; doi?: string; arxiv?: string; url?: string; pdf?: string },
  look: Lookup,
): Promise<Found | null> {
  // arXiv and Crossref are the primary sources: a missing record (404) is no match, any other failure propagates.
  const primary = (url: string) =>
    look.get(url).catch((e) => {
      if (e instanceof SourceError && e.status === 404) return undefined;
      throw e;
    });
  // ponytail: bioRxiv/PubMed/OpenAlex failures are dropped silently; report them if the owner needs to know one was down.
  const secondary = (url: string) => look.get(url).catch(() => undefined);
  const crossrefDoi = async (doi: string) => parseCrossrefWorks(json(await primary(`${CROSSREF}/${doi}`)))[0];

  const found: Found = {};
  const id = arxivId(pub);
  if (id) found.arxiv = parseArxivFeed((await primary(`${ARXIV}id_list=${q(id)}`)) ?? '').find((r) => r.arxiv === id);
  const doi = pub.doi?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '') || found.arxiv?.doi;
  if (doi) found.crossref = await crossrefDoi(doi);
  if (!found.arxiv && !doi) {
    const phrase = pub.title
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const feed = await primary(`${ARXIV}search_query=${q(`ti:"${phrase}"`)}&max_results=5`);
    found.arxiv = best(parseArxivFeed(feed ?? ''), pub);
  }
  // A published version of an arXiv paper, or the paper itself when arXiv didn't have it.
  if (!found.crossref) {
    const ref = found.arxiv ?? pub;
    found.crossref = best(
      parseCrossrefWorks(json(await primary(`${CROSSREF}?query.bibliographic=${q(ref.title)}&rows=5`))),
      ref,
    );
  }

  const preprintDoi = [doi, found.crossref?.doi].find((d) => d?.startsWith('10.1101/'));
  if (preprintDoi)
    for (const server of ['biorxiv', 'medrxiv'] as const) {
      found[server] = parseBiorxiv(
        json(await secondary(`https://api.biorxiv.org/details/${server}/${preprintDoi}`)),
        server,
      ).at(-1);
      if (found[server]) break;
    }
  const preprint = found.biorxiv ?? found.medrxiv;
  // bioRxiv's published DOI is proof of publication: Crossref has the journal's record.
  if (preprint?.publishedDoi && found.crossref?.doi !== preprint.publishedDoi)
    found.crossref = (await crossrefDoi(preprint.publishedDoi)) ?? found.crossref;

  const anyDoi = found.crossref?.doi ?? doi ?? preprint?.doi;
  const ref = found.arxiv ?? preprint ?? found.crossref ?? pub;
  const term = anyDoi ? `${anyDoi}[doi]` : `"${ref.title}"[title]`;
  const search = json(
    await secondary(`${EUTILS}esearch.fcgi?db=pubmed&retmode=json&retmax=5&tool=ScholarOS&term=${q(term)}`),
  ) as { esearchresult?: { idlist?: unknown } };
  const ids = search.esearchresult?.idlist;
  if (Array.isArray(ids) && ids.length) {
    const xml = await secondary(
      `${EUTILS}efetch.fcgi?db=pubmed&retmode=xml&tool=ScholarOS&id=${ids.map((i) => q(String(i))).join(',')}`,
    );
    const records = parsePubmed(xml ?? '');
    found.pubmed = anyDoi ? records[0] : best(records, ref);
  }

  found.openalex = anyDoi
    ? parseOpenAlex({ results: [json(await secondary(`${OPENALEX}/doi:${anyDoi}`))] })[0]
    : best(parseOpenAlex(json(await secondary(`${OPENALEX}?search=${q(ref.title)}&per-page=5`))), ref);

  const hits = Object.entries(found).filter(([, r]) => r);
  return hits.length ? Object.fromEntries(hits) : null;
}

const word = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** BibTeX built from merged fields, for a paper with neither a DOI nor an arXiv record. */
function builtBibtex(key: string, f: Completed): string {
  const [kind, venueField] =
    f.type === 'journal'
      ? ['article', 'journal']
      : f.type === 'conference' || f.type === 'workshop'
        ? ['inproceedings', 'booktitle']
        : ['misc', 'howpublished'];
  const pairs = [
    ['title', f.title],
    ['author', (f.authors as string[] | undefined)?.join(' and ')],
    ['year', f.year],
    [venueField, f.venue],
    ['doi', f.doi],
    ['url', f.url],
  ].filter(([, v]) => v);
  return `@${kind}{${key},\n${pairs.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
}

/** The completed fields and the source of each, by the spec's precedence. */
export async function completedFields(
  found: Found,
  current: { venue?: string; type?: string },
  look: Lookup,
): Promise<{ fields: Completed; sources: Partial<Record<Completable, Source>> }> {
  const fields: Completed = {};
  const sources: Partial<Record<Completable, Source>> = {};
  const set = (k: Completable, v: unknown, r: PaperRecord | undefined) => {
    if (!r || v === undefined || v === '' || v === 0 || (Array.isArray(v) && !v.length)) return;
    fields[k] = v;
    sources[k] = r.source;
  };
  const { arxiv } = found;
  const preprint = arxiv ?? found.biorxiv ?? found.medrxiv;
  // The paper's own server first, then the published record, then the catch-alls.
  const own = [arxiv, found.biorxiv, found.medrxiv, found.crossref, found.pubmed, found.openalex].filter(
    (r): r is PaperRecord => !!r,
  );
  for (const k of ['title', 'authors', 'abstract'] as const) {
    const r = own.find((r) => r[k]?.length);
    set(k, r?.[k], r);
  }

  if (arxiv) {
    set('arxiv', arxiv.arxiv, arxiv);
    set('url', `https://arxiv.org/abs/${arxiv.arxiv}`, arxiv);
    set('pdf', `https://arxiv.org/pdf/${arxiv.arxiv}`, arxiv);
  } else set('pdf', found.openalex?.pdf, found.openalex);

  // Venue and type change only on proof of publication, and never downgrade a published venue to a preprint.
  const published = [found.crossref, found.pubmed, found.openalex].find(
    (r) => r?.venue && r.type !== 'preprint' && inferType(r.venue) !== 'preprint',
  );
  if (published) {
    set('venue', published.venue, published);
    set('type', published.type ?? inferType(published.venue!), published);
    set('year', published.year, published);
  } else if (arxiv?.journalRef) {
    set('venue', arxiv.journalRef, arxiv);
    set('type', inferType(arxiv.journalRef), arxiv);
    set('year', arxiv.year, arxiv);
  } else if (preprint && (!current.venue || inferType(current.venue) === 'preprint')) {
    set('venue', preprint.source === 'arxiv' ? 'arXiv' : preprint.venue, preprint);
    set('type', 'preprint', preprint);
    set('year', preprint.year, preprint);
  }

  // A preprint's own DOI only: Crossref's DOI for an arXiv posting (10.48550/…) would replace arXiv's BibTeX.
  const doiRecord = published?.doi
    ? published
    : preprint
      ? preprint.doi
        ? preprint
        : undefined
      : own.find((r) => r.doi);
  set('doi', doiRecord?.doi, doiRecord);
  if (!arxiv && doiRecord) set('url', `https://doi.org/${doiRecord.doi}`, doiRecord);

  const title = word(fields.title) ?? '';
  const authors = (fields.authors as string[] | undefined) ?? [];
  const year = Number(fields.year) || own[0]?.year || 0;
  const key = generateId(authors, year, title);
  const bib =
    doiRecord &&
    (await look.get(`https://doi.org/${doiRecord.doi}`, 'application/x-bibtex').then(
      (s) => s.trim(),
      () => '',
    ));
  if (bib?.startsWith('@')) set('bibtex', bib, doiRecord);
  else if (arxiv) set('bibtex', arxivBibtex(arxiv, key), arxiv);
  else if (own[0])
    set(
      'bibtex',
      builtBibtex(key, {
        ...fields,
        year,
        venue: fields.venue ?? current.venue,
        type: fields.type ?? current.type,
      }),
      own[0],
    );
  return { fields, sources };
}

/** Minimum gap between calls per host: arXiv's API terms (one per 3 s); NCBI's 3 requests/s without a key. */
const GAPS: Record<string, number> = { 'export.arxiv.org': 3000, 'eutils.ncbi.nlm.nih.gov': 340 };
const ARXIV_RETRIES = 2;
const RETRY_WAIT = 5000;
const MAX_RETRY_WAIT = 30_000;

/** How long a 503/429 asks to wait (5 s without Retry-After), or null when that's longer than a run can wait. */
function retryWait(header: string | undefined, now: number): number | null {
  if (!header) return RETRY_WAIT;
  const secs = Number(header);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now;
  if (Number.isNaN(ms)) return RETRY_WAIT;
  return ms > MAX_RETRY_WAIT ? null : Math.max(ms, 0);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The real Lookup: the safe fetch, paced per host, with arXiv's 503/429 retried; `sleep` and `now` are for tests. */
export function paperLookup(opts: {
  siteUrl: string;
  email?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Lookup {
  const { siteUrl, email, sleep = pause, now = Date.now } = opts;
  const ua = `ScholarOS paper import (+${siteUrl}${email ? `; mailto:${email}` : ''})`;
  // One queue per paced host, so concurrent callers still keep the gap.
  const paced = new Map<string, { last: number; queue: Promise<unknown> }>();
  return {
    get(url, accept) {
      const contact = url.startsWith(EUTILS) ? 'email' : url.startsWith(OPENALEX) ? 'mailto' : '';
      const full = email && contact ? `${url}${url.includes('?') ? '&' : '?'}${contact}=${q(email)}` : url;
      const init = {
        siteUrl,
        headers: { Accept: accept ?? 'application/json, application/atom+xml', 'User-Agent': ua },
      };
      const host = url.match(/^https?:\/\/([^/?#]+)/i)?.[1].toLowerCase() ?? '';
      const gap = GAPS[host];
      if (!gap) return getText(full, init);
      const state = paced.get(host) ?? { last: -Infinity, queue: Promise.resolve() };
      paced.set(host, state);
      const run = state.queue.then(async () => {
        for (let attempt = 0; ; attempt++) {
          const wait = state.last + gap - now();
          if (wait > 0) await sleep(wait);
          const res = await getText(full, init).then(
            (text) => ({ text }),
            (error: unknown) => ({ error }),
          );
          state.last = now();
          if ('text' in res) return res.text;
          const e = res.error;
          const busy = e instanceof SourceError && (e.status === 503 || e.status === 429);
          const ms =
            busy && host === 'export.arxiv.org' && attempt < ARXIV_RETRIES ? retryWait(e.retryAfter, now()) : null;
          if (ms === null) throw e;
          await sleep(ms);
        }
      });
      state.queue = run.catch(() => {});
      return run;
    },
  };
}
