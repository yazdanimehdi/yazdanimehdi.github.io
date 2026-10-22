// Pure parsers for the paper sources (arXiv, bioRxiv/medRxiv, Crossref, PubMed, OpenAlex); no network here.

export type PubType = 'journal' | 'conference' | 'preprint' | 'workshop' | 'thesis' | 'book-chapter';

export interface PaperRecord {
  source: 'arxiv' | 'biorxiv' | 'medrxiv' | 'crossref' | 'pubmed' | 'openalex' | 'pdf';
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  arxiv?: string;
  primaryClass?: string;
  doi?: string;
  pmid?: string;
  /** YYYY-MM-DD: arXiv's announcement day, bioRxiv/medRxiv's posting day, PubMed's entry day. */
  date?: string;
  /** DOI of the published version, as reported by bioRxiv/medRxiv. */
  publishedDoi?: string;
  /** arXiv's arxiv:journal_ref. */
  journalRef?: string;
  venue?: string;
  type?: PubType;
  pdf?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()];
    const cp = dec ? Number(dec) : parseInt(hex, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp < 0xe000) ? '' : String.fromCodePoint(cp);
  });
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const text = (s: string) => collapse(decode(s.replace(/<[^>]+>/g, '')));

/** Inner text of the first `<tag …>…</tag>` in `xml`. */
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? text(m[1]) : undefined;
}

function all(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, 'g'))].map((m) => m[0]);
}

const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';
/** YYYY-MM-DD from numbers, or undefined unless it is a real calendar day. */
function ymd(y: unknown, m: unknown, d: unknown): string | undefined {
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(date) ? date : undefined;
}

/** The day of an RSS date ("Thu, 22 Oct 2026 00:00:00 -0400") as written, not shifted to UTC. */
function rssDay(s: string | undefined): string | undefined {
  const m = s?.match(/(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/);
  const month = m ? MONTHS.indexOf(m[2]) : -1;
  return m && month >= 0 && month % 3 === 0 ? ymd(m[3], month / 3 + 1, m[1]) : undefined;
}

const yearOf = (s: unknown) => Number(String(s ?? '').match(/\d{4}/)?.[0] ?? 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Parse an arXiv Atom feed (export.arxiv.org/api/query) into records. */
export function parseArxivFeed(xml: string): PaperRecord[] {
  return all(xml, 'entry').flatMap((entry) => {
    const id = tag(entry, 'id')?.match(/abs\/(.+?)(?:v\d+)?$/)?.[1];
    const title = tag(entry, 'title');
    if (!id || !title) return [];
    return [
      {
        source: 'arxiv' as const,
        title,
        authors: all(entry, 'author')
          .map((a) => tag(a, 'name') ?? '')
          .filter(Boolean),
        year: yearOf(tag(entry, 'published')),
        abstract: tag(entry, 'summary'),
        arxiv: id,
        primaryClass: entry.match(/<arxiv:primary_category[^>]*\bterm="([^"]+)"/)?.[1],
        doi: tag(entry, 'arxiv:doi'),
        journalRef: tag(entry, 'arxiv:journal_ref'),
      },
    ];
  });
}

/** Parse an arXiv RSS feed (rss.arxiv.org/rss/<categories>) into records with their categories and announce type. */
export function parseArxivRss(xml: string): (PaperRecord & { announce: string; categories: string[] })[] {
  return all(xml, 'item').flatMap((item) => {
    const id = tag(item, 'link')?.match(/abs\/(.+?)(?:v\d+)?$/)?.[1];
    const title = tag(item, 'title');
    if (!id || !title) return [];
    return [
      {
        source: 'arxiv' as const,
        title,
        authors: (tag(item, 'dc:creator') ?? '')
          .split(', ')
          .map((a) => a.trim())
          .filter(Boolean),
        year: yearOf(tag(item, 'pubDate')),
        date: rssDay(tag(item, 'pubDate')),
        abstract: tag(item, 'description')?.match(/Abstract:\s*([\s\S]+)/)?.[1],
        arxiv: id,
        announce: tag(item, 'arxiv:announce_type') ?? '',
        categories: all(item, 'category').map((c) => tag(c, 'category') ?? ''),
      },
    ];
  });
}

/** Parse a DataCite `/dois` response (one DOI or a search) for arXiv's 10.48550 DOIs into arXiv records. */
export function parseDatacite(json: unknown): PaperRecord[] {
  const data = obj(json).data;
  return (Array.isArray(data) ? data : [data]).flatMap((raw) => {
    const a = obj(obj(raw).attributes);
    const id =
      str(a.url)?.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i)?.[1] ??
      str(a.doi)?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
    const title = str(obj(list(a.titles)[0]).title);
    if (!id || !title) return [];
    const descriptions = list(a.descriptions).map(obj);
    const abstract = str(descriptions.find((d) => d.descriptionType === 'Abstract')?.description);
    // ponytail: the first arXiv-scheme subject is taken as the primary category; DataCite lists them in arXiv's order.
    const category = list(a.subjects)
      .map(obj)
      .find((s) => s.subjectScheme === 'arXiv');
    const published = list(a.relatedIdentifiers)
      .map(obj)
      .find((r) => r.relationType === 'IsVersionOf' && r.relatedIdentifierType === 'DOI');
    return [
      {
        source: 'arxiv' as const,
        title: text(title),
        authors: list(a.creators)
          .map(obj)
          .map((c) => [str(c.givenName), str(c.familyName)].filter(Boolean).join(' ') || str(c.name) || '')
          .filter(Boolean),
        year: yearOf(a.publicationYear),
        abstract: abstract ? text(abstract) : undefined,
        arxiv: id,
        primaryClass: str(category?.subject)?.match(/\(([^()]+)\)$/)?.[1],
        doi: str(published?.relatedIdentifier),
      },
    ];
  });
}

const CROSSREF_TYPES: Record<string, PubType> = {
  'journal-article': 'journal',
  'proceedings-article': 'conference',
  'posted-content': 'preprint',
  'book-chapter': 'book-chapter',
};

/** Parse a Crossref `/works` response (a list or a single work) into records. */
export function parseCrossrefWorks(json: unknown): PaperRecord[] {
  const message = obj(obj(json).message);
  const items = Array.isArray(message.items) ? message.items : message.DOI ? [message] : [];
  return items.flatMap((raw) => {
    const w = obj(raw);
    const title = str(list(w.title)[0]);
    if (!title) return [];
    const authors = list(w.author)
      .map((a) => [str(obj(a).given), str(obj(a).family)].filter(Boolean).join(' '))
      .filter(Boolean);
    const issued = list(list(obj(w.issued)['date-parts'])[0])[0];
    return [
      {
        source: 'crossref' as const,
        title: text(title),
        authors,
        year: Number(issued) || 0,
        abstract: str(w.abstract)
          ? text((w.abstract as string).replace(/<jats:title>[\s\S]*?<\/jats:title>/g, ''))
          : undefined,
        doi: str(w.DOI),
        venue: str(list(w['container-title'])[0]),
        type: CROSSREF_TYPES[String(w.type)],
      },
    ];
  });
}

/** Parse a bioRxiv/medRxiv `details` response. Authors stay as "Last, F." strings. */
export function parseBiorxiv(json: unknown, server: 'biorxiv' | 'medrxiv'): PaperRecord[] {
  return list(obj(json).collection).flatMap((raw) => {
    const c = obj(raw);
    const title = str(c.title);
    if (!title) return [];
    const published = str(c.published);
    return [
      {
        source: server,
        title: text(title),
        authors: (str(c.authors) ?? '')
          .split(';')
          .map((a) => a.trim())
          .filter(Boolean),
        year: yearOf(c.date),
        date: str(c.date)?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0],
        abstract: str(c.abstract) ? collapse(c.abstract as string) : undefined,
        doi: str(c.doi),
        publishedDoi: published && published !== 'NA' ? published : undefined,
        venue: server === 'biorxiv' ? 'bioRxiv' : 'medRxiv',
        type: 'preprint' as const,
      },
    ];
  });
}

/** Parse PubMed efetch XML into records. */
export function parsePubmed(xml: string): PaperRecord[] {
  return all(xml, 'PubmedArticle').flatMap((art) => {
    const title = tag(art, 'ArticleTitle');
    if (!title) return [];
    const authors = all(art, 'Author')
      .map((a) => [tag(a, 'ForeName'), tag(a, 'LastName')].filter(Boolean).join(' ') || tag(a, 'CollectiveName') || '')
      .filter(Boolean);
    const abstract = all(art, 'AbstractText')
      .map((p) => text(p))
      .filter(Boolean)
      .join(' ');
    const pubDate = tag(art, 'PubDate') ?? '';
    const journal = art.match(/<Journal>([\s\S]*?)<\/Journal>/)?.[1] ?? '';
    // The entry date: always a full day, and the date esearch's datetype=edat window filters on (PubDate is often partial).
    const entrez = art.match(/<PubMedPubDate PubStatus="entrez">([\s\S]*?)<\/PubMedPubDate>/)?.[1];
    return [
      {
        source: 'pubmed' as const,
        title: title.replace(/\.$/, ''),
        authors,
        year: yearOf(pubDate) || yearOf(tag(art, 'MedlineDate')),
        abstract: abstract || undefined,
        doi: art.match(/<ELocationID[^>]*EIdType="doi"[^>]*>([^<]+)</)?.[1]?.trim(),
        pmid: tag(art, 'PMID'),
        date: entrez ? ymd(tag(entrez, 'Year'), tag(entrez, 'Month'), tag(entrez, 'Day')) : undefined,
        venue: tag(journal, 'Title'),
        type: 'journal' as const,
      },
    ];
  });
}

// OpenAlex files proceedings papers under `article`; the venue's own type tells a conference from a journal.
// A repository (arXiv, Zenodo, HAL…) or no venue is no proof of publication, so no type.
const OPENALEX_VENUE_TYPES: Record<string, PubType> = { conference: 'conference', journal: 'journal' };

/** Parse an OpenAlex `/works` response into records. */
export function parseOpenAlex(json: unknown): PaperRecord[] {
  return list(obj(json).results).flatMap((raw) => {
    const w = obj(raw);
    const title = str(w.display_name) ?? str(w.title);
    if (!title) return [];
    const venue = obj(obj(w.primary_location).source);
    const pdf = str(obj(w.best_oa_location).pdf_url);
    const words: string[] = [];
    for (const [word, at] of Object.entries(obj(w.abstract_inverted_index)))
      for (const i of list(at)) words[Number(i)] = word;
    return [
      {
        source: 'openalex' as const,
        title,
        authors: list(w.authorships)
          .map((a) => str(obj(obj(a).author).display_name) ?? '')
          .filter(Boolean),
        year: Number(w.publication_year) || 0,
        abstract: words.length ? collapse(words.filter(Boolean).join(' ')) : undefined,
        doi: str(w.doi)?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''),
        venue: str(venue.display_name),
        type: w.type === 'preprint' ? ('preprint' as const) : OPENALEX_VENUE_TYPES[String(venue.type)],
        pdf: pdf && /^https?:\/\//i.test(pdf) ? pdf : undefined,
      },
    ];
  });
}

/** BibTeX in arXiv's own `@misc` format. */
export function arxivBibtex(r: PaperRecord, key: string): string {
  const fields = [
    ['title', r.title],
    ['author', r.authors.join(' and ')],
    ['year', String(r.year)],
    ['eprint', r.arxiv],
    ['archivePrefix', 'arXiv'],
    ['primaryClass', r.primaryClass],
    ['url', `https://arxiv.org/abs/${r.arxiv}`],
  ].filter(([, v]) => v);
  return `@misc{${key},\n${fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
}
