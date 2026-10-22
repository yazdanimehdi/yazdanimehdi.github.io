/* eslint-disable @typescript-eslint/no-explicit-any -- SerpApi responses are parsed defensively from unknown JSON */
import type { ImageOutput, TextInput } from '../ai/providers';
import { resolveAiConfig, type PapersSchedule } from '../ai/providers';
import { imagePrompt, paperPostPrompt, parsePaperPost, type PaperInput, type PaperPost } from '../ai/prompts';
import { suggestSlug } from '../utils';
import { generateImage, generateText, readAiConfig, saveImage } from './ai';
import { entryChange, listEntries, readConfig } from './content';
import { commitChanges } from './http';
import { completedFields, findPaper, paperLookup, type Completed, type Declined, type Lookup } from './paper-complete';
import { SCHOLAR_JSON } from './paths';
import { getSecret, secretsDb } from './secrets';
import { UpstreamError, type Change, type ContentStore } from './store';

/** What syncPapers calls outside the store; tests pass fakes. */
export interface PapersDeps {
  /** One SerpApi search; resolves to its JSON, throws on an error answer. */
  serpapi(params: Record<string, string>): Promise<any>;
  text(input: TextInput): Promise<string>;
  image(prompt: string): Promise<ImageOutput>;
  /** The network for completing new papers from arXiv, Crossref and the rest. */
  lookup: Lookup;
  /** Milliseconds now, for the completion deadline; tests pass a fake. */
  clock?: () => number;
}

export type { PapersSchedule };

/** Whether the daily run should sync today (UTC date). Missing weekday/monthday default to Monday / the 1st. */
export function papersDue(s: PapersSchedule, now: Date): boolean {
  if (s.every === 'off') return false;
  if (s.every === 'week') return now.getUTCDay() === (s.weekday ?? 1);
  if (s.every === 'month') return now.getUTCDate() === (s.monthday ?? 1);
  return true;
}

/** New papers completed per run: about 30–60 s of paced arXiv calls; the rest wait for Complete papers. */
export const COMPLETE_PER_RUN = 10;
/** No new completion starts this long after the first, so a slow source can't push the run past the function limit. */
export const COMPLETE_FOR_MS = 90_000;

export interface PapersResult {
  /** Publication slugs written this run. */
  imported: string[];
  /** Draft post slugs written this run. */
  posts: string[];
  /** Citation ids left for the next run (over maxPostsPerRun): neither imported nor marked seen. */
  deferred: string[];
  /** Publication slugs imported as Scholar gave them: past the budget, unmatched, or a source failed. */
  notCompleted: string[];
  failed: { item: string; error: string }[];
  /** Set when the run did nothing because it can't (no Scholar id). */
  skipped?: string;
}

export interface ScholarState {
  seen: string[];
  /** Set by every committed sync; absent until the first, which is then a baseline. */
  lastRun?: string;
  /** Completions the owner declined for existing papers (Complete papers). */
  declined?: Declined;
}

interface Article {
  citationId: string;
  title: string;
  link?: string;
  authors: string[];
  venue: string;
  year: number;
}

/** A paper's network work for its post: the abstract, then the post or why it failed, then the cover or why it failed. */
type Draft = { abstract?: string } & ({ error: string } | { post: PaperPost; image: ImageOutput | { error: string } });

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'to', 'with', 'is', 'are']);

/** `smith2024adaptive`: first author's last name, year, first significant title word (scripts/sync-scholar.py). */
export function generateId(authors: string[], year: number, title: string): string {
  const last = (authors[0] ?? '').trim().split(/\s+/).pop() ?? '';
  const lastname = last.toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
  const word = (title.toLowerCase().match(/[a-z]+/g) ?? []).find((w) => !STOP_WORDS.has(w) && w.length > 2);
  return `${lastname}${year}${word ?? 'untitled'}`;
}

const TYPES: [type: string, keywords: string[]][] = [
  ['preprint', ['arxiv', 'preprint', 'biorxiv', 'medrxiv', 'ssrn']],
  ['journal', ['journal', 'transactions', 'letters']],
  ['workshop', ['workshop', 'w@']],
  ['thesis', ['thesis', 'dissertation']],
  ['book-chapter', ['book', 'chapter', 'springer', 'lecture notes']],
];

/** Publication type from the venue name; proceedings and named venues are conferences. */
export function inferType(venue: string): string {
  const v = venue.toLowerCase();
  return TYPES.find(([, keywords]) => keywords.some((k) => v.includes(k)))?.[0] ?? 'conference';
}

export const normalizeTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, '');

/** An article from SerpApi's author page, or null when it lacks an id, a title or a year. */
function toArticle(raw: any): Article | null {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const citationId = str(raw?.citation_id);
  const title = str(raw?.title);
  const publication = str(raw?.publication);
  const year = Number.parseInt(String(raw?.year ?? ''), 10) || Number(/(\d{4})$/.exec(publication)?.[1]);
  if (!citationId || !title || !Number.isInteger(year) || year <= 0) return null;
  const authors = str(raw?.authors)
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a && a !== '...' && a !== '…');
  return {
    citationId,
    title,
    link: /^https?:\/\//.test(str(raw?.link)) ? str(raw?.link) : undefined,
    authors,
    venue: publication.replace(new RegExp(`,?\\s*${year}$`), '').trim(),
    year,
  };
}

const unique = (base: string, taken: Set<string>) => {
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 76)}-${n}`;
  taken.add(slug);
  return slug;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function parseState(text: string | undefined): ScholarState {
  try {
    const raw = JSON.parse(text ?? '');
    const declined = raw?.declined && typeof raw.declined === 'object' && !Array.isArray(raw.declined);
    return {
      seen: Array.isArray(raw?.seen) ? raw.seen.filter((s: unknown) => typeof s === 'string') : [],
      ...(typeof raw?.lastRun === 'string' ? { lastRun: raw.lastRun } : {}),
      ...(declined ? { declined: raw.declined as Declined } : {}),
    };
  } catch {
    return { seen: [] };
  }
}

/**
 * New Scholar papers → publications (and, past the first run, draft posts), committed together with the seen list.
 * The first run (no scholar.json) is a baseline: it imports and marks everything, writing no posts.
 */
export async function syncPapers(store: ContentStore, deps: PapersDeps, now = new Date()): Promise<PapersResult> {
  const [scholar, ai, stateFile, publications, posts] = await Promise.all([
    readConfig(store, 'scholar'),
    readConfig(store, 'ai'),
    store.read(SCHOLAR_JSON),
    listEntries(store, 'publications'),
    listEntries(store, 'posts'),
  ]);
  const result: PapersResult = { imported: [], posts: [], deferred: [], notCompleted: [], failed: [] };
  const authors = (Array.isArray(scholar.data.authors) ? scholar.data.authors : [])
    .map((a: any) => (typeof a?.scholar_id === 'string' ? a.scholar_id.trim() : ''))
    .filter(Boolean);
  if (!authors.length) return { ...result, skipped: 'no Scholar author id in config/scholar.yml' };

  // A file holding only declines (written before any sync) still leaves the first sync a baseline.
  const prev = parseState(stateFile?.content);
  const baseline = !prev.lastRun;
  const seen = new Set(prev.seen);
  const { autoPost, maxPostsPerRun } = resolveAiConfig(ai.data).papers;

  // One failed author fails the run: a partial baseline would turn the missing papers into posts next time.
  const articles: Article[] = [];
  for (const author_id of authors) {
    const data = await deps.serpapi({ engine: 'google_scholar_author', author_id, sort: 'pubdate', num: '100' });
    for (const raw of Array.isArray(data?.articles) ? data.articles : []) {
      const a = toArticle(raw);
      if (a && !seen.has(a.citationId) && !articles.some((b) => b.citationId === a.citationId)) articles.push(a);
    }
  }
  articles.sort((a, b) => b.year - a.year);

  const titles = new Set(publications.map((p) => normalizeTitle(String(p.data.title ?? ''))));
  const pubSlugs = new Set(publications.map((p) => p.slug));
  const postSlugs = new Set(posts.map((p) => p.slug));
  const changes: Change[] = [];
  const newlySeen: string[] = [];
  const today = now.toISOString().slice(0, 10);
  let drafted = 0;

  const planned: { a: Article; pubSlug: string; writePost: boolean }[] = [];
  for (const a of articles) {
    // Manual entries win; also the same paper listed under two configured authors.
    if (titles.has(normalizeTitle(a.title))) {
      newlySeen.push(a.citationId);
      continue;
    }
    const writePost = !baseline && autoPost && maxPostsPerRun > 0;
    if (writePost && drafted >= maxPostsPerRun) {
      result.deferred.push(a.citationId);
      continue;
    }
    if (writePost) drafted++;
    titles.add(normalizeTitle(a.title));
    newlySeen.push(a.citationId);
    planned.push({ a, pubSlug: unique(generateId(a.authors, a.year, a.title), pubSlugs), writePost });
  }

  // The completed fields win over Scholar's: its scholar.google.com link stays only when no url was found.
  const pubOf = (a: Article, abstract?: string, fields: Completed = {}) => ({
    title: a.title,
    authors: a.authors,
    venue: a.venue || 'Unknown venue',
    year: a.year,
    url: a.link,
    type: inferType(a.venue),
    featured: false,
    abstract,
    // Checked against the publication schema before it is kept (below).
    ...(fields as Partial<PaperInput>),
  });

  // Sequential: arXiv's pacing serialises its calls anyway. The budget, the deadline and stopping at the first source
  // failure (a down arXiv costs ~20–65 s a paper in timeouts and retries) keep the run inside the function limit.
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + COMPLETE_FOR_MS;
  let sourceFailed = false;
  const completed: (Completed | undefined)[] = [];
  for (const [i, { a, pubSlug }] of planned.entries()) {
    if (i < COMPLETE_PER_RUN && !sourceFailed && clock() < deadline) {
      let fields: Completed | undefined;
      try {
        const found = await findPaper({ title: a.title, authors: a.authors, url: a.link }, deps.lookup);
        if (found)
          fields = (await completedFields(found, { venue: a.venue, type: inferType(a.venue) }, deps.lookup)).fields;
      } catch (e) {
        sourceFailed = true;
        result.failed.push({ item: `completing ${pubSlug}`, error: message(e) });
      }
      // A field the schema refuses fails this paper only.
      if (fields)
        try {
          entryChange('publications', pubSlug, pubOf(a, undefined, fields), '');
          completed[i] = fields;
          continue;
        } catch (e) {
          result.failed.push({ item: `completing ${pubSlug}`, error: message(e) });
        }
    }
    result.notCompleted.push(pubSlug);
  }

  // Concurrent so a run of several slow model calls stays inside the function time limit.
  const drafts = await Promise.all(
    planned.map(async ({ a, writePost }, i): Promise<Draft | undefined> => {
      if (!writePost) return undefined;
      const fields = completed[i];
      let abstract = typeof fields?.abstract === 'string' ? fields.abstract : undefined;
      if (!abstract)
        try {
          const cited = await deps.serpapi({
            engine: 'google_scholar_author',
            view_op: 'view_citation',
            citation_id: a.citationId,
          });
          abstract =
            typeof cited?.citation?.description === 'string'
              ? cited.citation.description.trim() || undefined
              : undefined;
        } catch {
          // the post is still written, from the title alone
        }
      let post: PaperPost;
      try {
        post = parsePaperPost(await deps.text(paperPostPrompt(pubOf(a, abstract, fields))));
      } catch (e) {
        return { abstract, error: message(e) };
      }
      try {
        return { abstract, post, image: await deps.image(imagePrompt(post)) };
      } catch (e) {
        return { abstract, post, image: { error: message(e) } };
      }
    }),
  );

  // Sequential: in git mode each saveImage is its own commit, and concurrent commits on one branch conflict.
  for (const [i, { a, pubSlug }] of planned.entries()) {
    const draft = drafts[i];
    changes.push(entryChange('publications', pubSlug, pubOf(a, draft?.abstract, completed[i]), ''));
    result.imported.push(pubSlug);
    if (!draft) continue;

    if ('error' in draft) {
      result.failed.push({ item: `post for ${pubSlug}`, error: draft.error });
      continue;
    }
    const { post, image } = draft;
    const postSlug = unique(suggestSlug(post.title) || `${pubSlug}-post`, postSlugs);
    const cover =
      'error' in image ? image : await saveImage(store, postSlug, image).catch((e: unknown) => ({ error: message(e) }));
    if ('error' in cover) result.failed.push({ item: `cover image for ${postSlug}`, error: cover.error });
    const data = {
      title: post.title,
      subtitle: post.subtitle,
      excerpt: post.excerpt,
      tags: post.tags.length ? post.tags : undefined,
      date: today,
      draft: true,
      relatedPublication: pubSlug,
      coverImage: 'error' in cover ? undefined : cover.url,
    };
    try {
      changes.push(entryChange('posts', postSlug, data, post.body));
      result.posts.push(postSlug);
    } catch (e) {
      result.failed.push({ item: `post for ${pubSlug}`, error: message(e) });
    }
  }

  // Nothing new: no commit (in git mode every commit redeploys the site).
  if (!baseline && newlySeen.length === 0) return result;
  const state: ScholarState = { ...prev, seen: [...seen, ...newlySeen], lastRun: now.toISOString() };
  changes.push({ path: SCHOLAR_JSON, content: `${JSON.stringify(state, null, 2)}\n` });
  await commitChanges(store, changes, 'Import papers from Google Scholar', {
    [SCHOLAR_JSON]: stateFile?.version ?? null,
  });
  return result;
}

/** A SerpApi search client; an `error` answer (bad key, unknown author, quota) is a 502 with SerpApi's message. */
export function serpapiClient(key: string, fetchFn: typeof fetch = fetch): PapersDeps['serpapi'] {
  return async (params) => {
    const url = new URL('https://serpapi.com/search.json');
    for (const [k, v] of Object.entries({ ...params, api_key: key })) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new UpstreamError(`SerpApi could not be reached: ${message(e)}`);
    }
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok || !data || typeof data.error === 'string') {
      throw new UpstreamError(`SerpApi answered ${res.status}: ${data?.error ?? res.statusText}`);
    }
    return data;
  };
}

/** The real dependencies, or null when SERPAPI_KEY is unset (the cron step then skips). */
export async function papersDeps(store: ContentStore): Promise<PapersDeps | null> {
  const key = await getSecret(secretsDb(store), 'SERPAPI_KEY');
  if (!key) return null;
  const [config, lookup] = await Promise.all([readAiConfig(store), paperLookupFor(store)]);
  return {
    serpapi: serpapiClient(key),
    text: (input) => generateText(store, config, input),
    image: (prompt) => generateImage(store, config, prompt),
    lookup,
  };
}

let testLookup: Lookup | null = null;

/** Tests swap the paper sources' network; production code never calls this. */
export function setPaperLookupForTests(lookup: Lookup | null): void {
  testLookup = lookup;
}

/** The paper sources' network, identified by the site's URL and email (site.yml socials, else the CV's). */
export async function paperLookupFor(store: ContentStore): Promise<Lookup> {
  if (testLookup) return testLookup;
  const [site, cv] = await Promise.all([readConfig(store, 'site'), readConfig(store, 'cv')]);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const email = str((site.data.socials as any)?.email) ?? str((cv.data.cv as any)?.email);
  return paperLookup({ siteUrl: str(site.data.siteUrl) ?? '', email });
}

/** "Imported 2 · drafted 1 · failed: …" for the jobs record and the AI screen. */
export function papersSummary(r: PapersResult): string {
  if (r.skipped) return `skipped: ${r.skipped}`;
  const parts = [`imported ${r.imported.length}`, `drafted ${r.posts.length}`];
  if (r.deferred.length) parts.push(`${r.deferred.length} left for the next run`);
  if (r.notCompleted.length) parts.push(`${r.notCompleted.length} not completed (use Complete papers)`);
  if (r.failed.length) parts.push(`failed: ${r.failed.map((f) => `${f.item}: ${f.error}`).join('; ')}`);
  return parts.join(' · ');
}
