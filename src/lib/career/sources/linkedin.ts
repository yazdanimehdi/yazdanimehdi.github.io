import type { Element } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { EXIT, SKIP, visit } from 'unist-util-visit';
import type { RawPosting } from '../types';
import { textOf } from './careers-page';
import { fromGoogleJob, searchGoogleJobs } from './google-jobs';
import { getText, SourceError } from './http';
import type { Source, SourceContext } from './index';
import { fetchInit, locationsOf, MAX_POSTINGS, queryOf } from './query';

const SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PAGES = 2;
const PAGE_SIZE = 10;
// The fallback reads one Google Jobs page per location: at most 3 SerpAPI credits.
const GOOGLE_PAGES = 1;

/** The first element under `root` with a class starting with `prefix`. */
function byClass(root: Element, prefix: string): Element | undefined {
  let hit: Element | undefined;
  visit(root, 'element', (el) => {
    if ((el.properties.className as string[] | undefined)?.some((c) => c.startsWith(prefix))) {
      hit = el;
      return EXIT;
    }
  });
  return hit;
}

const textIn = (root: Element, prefix: string) => {
  const el = byClass(root, prefix);
  return el ? textOf(el).replace(/\s+/g, ' ').trim() : '';
};

/** Guest search answers a list of job cards, each tagged `data-entity-urn="urn:li:jobPosting:<id>"`. */
export function parseCards(html: string): RawPosting[] {
  const out: RawPosting[] = [];
  visit(fromHtml(html, { fragment: true }), 'element', (card) => {
    const id = /^urn:li:jobPosting:(\d+)$/.exec(String(card.properties.dataEntityUrn ?? ''))?.[1];
    if (!id) return;
    const title = textIn(card, 'base-search-card__title');
    const posted = byClass(card, 'job-search-card__listdate')?.properties.dateTime;
    if (title)
      out.push({
        source: 'linkedin',
        externalId: id,
        company: textIn(card, 'base-search-card__subtitle'),
        title,
        location: textIn(card, 'job-search-card__location') || undefined,
        url: `https://www.linkedin.com/jobs/view/${id}`,
        description: '',
        format: 'text',
        postedAt: typeof posted === 'string' ? posted : undefined,
      });
    return SKIP;
  });
  return out;
}

/**
 * LinkedIn's guest search, as ai-job-search's linkedin-search does it: the honest job-search User-Agent, no cookies, and
 * no robots.txt check (it disallows everything; the owner opts in past the terms warning). The first refusal stops it,
 * keeping what earlier pages found.
 */
async function guestSearch(ctx: SourceContext): Promise<RawPosting[]> {
  const seen = new Map<string, RawPosting>();
  try {
    for (const location of locationsOf(ctx.prefs)) {
      for (let page = 0; page < PAGES; page++) {
        const params = new URLSearchParams({
          keywords: queryOf(ctx.prefs),
          location: location ?? '',
          start: String(page * PAGE_SIZE),
        });
        const cards = parseCards(await getText(`${SEARCH}?${params}`, fetchInit(ctx)));
        for (const c of cards) if (!seen.has(c.externalId)) seen.set(c.externalId, c);
        if (!cards.length) break;
      }
    }
  } catch (e) {
    if (!seen.size) throw e;
  }
  return [...seen.values()];
}

const isLinkedIn = (link: string) => {
  try {
    return /(^|\.)linkedin\.com$/.test(new URL(link).hostname);
  } catch {
    return false;
  }
};

/** LinkedIn's listings as Google Jobs shows them, linked to the LinkedIn posting. */
async function viaGoogle(ctx: SourceContext): Promise<RawPosting[]> {
  return (await searchGoogleJobs(ctx, GOOGLE_PAGES)).flatMap((j) => {
    const link = j.apply_options?.find((o) => isLinkedIn(o.link))?.link;
    return link ? [fromGoogleJob(j, 'linkedin', link)] : [];
  });
}

export const linkedin: Source = {
  id: 'linkedin',
  label: 'LinkedIn (guest search)',
  defaultOn: false,
  warning:
    "LinkedIn's terms forbid automated access and its robots.txt disallows it; keep it to personal use. It reads only the public guest search, never your account, but LinkedIn may block the server's IP. When LinkedIn refuses or finds nothing, it falls back to LinkedIn's listings on Google Jobs if SERPAPI_KEY is set (up to 3 credits).",
  async search(ctx) {
    if (!queryOf(ctx.prefs).trim()) return [];
    const hasKey = !!(await ctx.secret('SERPAPI_KEY'))?.trim();
    let found: RawPosting[] = [];
    try {
      found = await guestSearch(ctx);
    } catch (e) {
      if (!(e instanceof SourceError) || !hasKey) throw e;
    }
    if (!found.length && hasKey) found = await viaGoogle(ctx);
    return found.slice(0, MAX_POSTINGS);
  },
};
