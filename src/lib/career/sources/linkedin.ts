import type { Element } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { EXIT, SKIP, visit } from 'unist-util-visit';
import type { RawPosting } from '../types';
import { textOf } from './careers-page';
import type { Source } from './index';
import { fetchInit, locationsOf, MAX_POSTINGS, queryOf } from './query';
import { fetchAllowed } from './robots';

const SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PAGES = 2;
const PAGE_SIZE = 10;

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

export const linkedin: Source = {
  id: 'linkedin',
  label: 'LinkedIn (guest search)',
  defaultOn: false,
  warning:
    "LinkedIn's terms forbid automated access; using this can get your account or IP blocked. It reads only the public guest search, never your account.",
  async search(ctx) {
    const keywords = queryOf(ctx.prefs);
    if (!keywords.trim()) return [];
    const seen = new Map<string, RawPosting>();
    for (const location of locationsOf(ctx.prefs)) {
      for (let page = 0; page < PAGES; page++) {
        const params = new URLSearchParams({ keywords, location: location ?? '', start: String(page * PAGE_SIZE) });
        // Through robots.txt like any page, with no cookies or auth headers.
        const cards = parseCards(await fetchAllowed(`${SEARCH}?${params}`, fetchInit(ctx)));
        for (const c of cards) if (!seen.has(c.externalId)) seen.set(c.externalId, c);
        if (!cards.length) break;
      }
    }
    return [...seen.values()].slice(0, MAX_POSTINGS);
  },
};
