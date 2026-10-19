import { slugify } from './utils';
import type { HomepageSectionId, SocialLinks } from './types';

/** "Prof. Jane Smith" → "Jane Smith". Used to find the site owner in author lists. */
export function stripHonorific(name: string): string {
  return name
    .trim()
    .replace(/^(prof|dr)\.?\s+/i, '')
    .trim();
}

/** `owners`: the site author, or every name to bold (see `boldedAuthors`). */
export function isOwner(author: string, owners: string | readonly string[]): boolean {
  const name = stripHonorific(author);
  return (typeof owners === 'string' ? [owners] : owners).some((o) => stripHonorific(o) === name);
}

/**
 * Names bolded in author lists: the site author, and on a lab site every current member too. A member is past
 * when their role is alumni, they are marked inactive, or their end date has passed.
 */
export function boldedAuthors(
  siteAuthor: string,
  siteMode: 'personal' | 'lab',
  people: readonly { name: string; role: string; active?: boolean; endDate?: Date }[],
  now = new Date(),
): string[] {
  if (siteMode === 'personal') return [siteAuthor];
  const current = people.filter((p) => p.role !== 'alumni' && p.active !== false && !(p.endDate && p.endDate < now));
  return [siteAuthor, ...current.map((p) => p.name)];
}

/** "https://doi.org/10.1/x" → "10.1/x". */
export function bareDoi(doi: string): string {
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
}

/** "arXiv:2410.12459" or "https://arxiv.org/abs/2410.12459" → "2410.12459". */
export function bareArxiv(id: string): string {
  return id
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, '');
}

/** Paper link priority: url → doi → arXiv. */
export function paperLink(p: { url?: string; doi?: string; arxiv?: string }): string | undefined {
  if (p.url) return p.url;
  if (p.doi) return `https://doi.org/${bareDoi(p.doi)}`;
  if (p.arxiv) return `https://arxiv.org/abs/${bareArxiv(p.arxiv)}`;
  return undefined;
}

/** "HELM: Hierarchical Encoding…" → "HELM"; titles without a usable colon prefix stay whole. */
export function shortTitle(title: string): string {
  return title.split(':')[0].trim() || title.trim();
}

// ── Research areas ────────────────────────────────────────────────

export interface ResearchAreaInput {
  id?: string;
  label?: string;
  title: string;
  description: string;
  body?: string;
  result?: string;
  figure?: string;
  caption?: string;
  publications?: string[];
  tags?: string[];
}

export interface ResearchConfig {
  headline?: string;
  description?: string;
  areas?: ResearchAreaInput[];
}

export interface ResearchArea extends ResearchAreaInput {
  id: string;
  label: string;
  numeral: string;
  publications: string[];
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

export function toRoman(n: number): string {
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

/** Ids already used by the Research page itself; areas never take them. */
const RESERVED_IDS = ['software', 'main-content', 'all', 'other'];

/** Fills in id (slug of title, unique on the page), label and numeral ("i.", "ii.", …). */
export function normalizeAreas(areas: ResearchAreaInput[] = []): ResearchArea[] {
  const seen = new Set(RESERVED_IDS);
  return areas.map((area, i) => {
    const base = slugify(area.id ?? '') || slugify(area.title) || `area-${i + 1}`;
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    return {
      ...area,
      id,
      label: area.label?.trim() || area.title,
      numeral: `${toRoman(i + 1)}.`,
      publications: area.publications ?? [],
    };
  });
}

/** Publication topic → research-area id, or 'other' when it matches none. */
export function topicOf(topic: string | undefined, areaIds: ReadonlySet<string>): string {
  const id = slugify(topic ?? '');
  return id && areaIds.has(id) ? id : 'other';
}

export interface TopicFilter {
  id: string;
  label: string;
  count: number;
}

/** "All", then every area that has papers, then "Other" if any paper matched no area. */
export function topicFilters(topics: string[], areas: { id: string; label: string }[]): TopicFilter[] {
  const count = (id: string) => topics.filter((t) => t === id).length;
  return [
    { id: 'all', label: 'All', count: topics.length },
    ...areas.map((a) => ({ id: a.id, label: a.label, count: count(a.id) })).filter((f) => f.count > 0),
    ...(count('other') > 0 ? [{ id: 'other', label: 'Other', count: count('other') }] : []),
  ];
}

// ── Writing (site posts + external feeds) ─────────────────────────

export interface WritingItem {
  kind: 'site' | 'external';
  title: string;
  href: string;
  date: Date;
  excerpt?: string;
  /** External only: feed source name, e.g. "Medium". */
  source?: string;
  /** Site only: reading time. */
  minutes?: number;
  /** Site only: first tag. */
  tag?: string;
  /** Site only: "Show on home page". */
  featured?: boolean;
}

const time = (d: Date) => (Number.isFinite(d.getTime()) ? d.getTime() : -Infinity);

/** Newest first (ties by href); items with unparseable dates go last. */
export function mergeWriting(items: WritingItem[]): WritingItem[] {
  return [...items].sort((a, b) => time(b.date) - time(a.date) || a.href.localeCompare(b.href));
}

/** Home page order: featured site posts first; each group keeps its newest-first order. */
export function featuredFirst(items: WritingItem[]): WritingItem[] {
  return [...items.filter((i) => i.featured), ...items.filter((i) => !i.featured)];
}

/** Label for the third Writing tab: the one shared feed source ("Medium"), else "Elsewhere". */
export function elsewhereLabel(sources: string[]): string {
  const unique = [...new Set(sources.map((s) => s.trim()).filter(Boolean))];
  return unique.length === 1 ? unique[0] : 'Elsewhere';
}

// ── Home page ─────────────────────────────────────────────────────

const SOCIAL_LABELS: [keyof SocialLinks, string][] = [
  ['scholar', 'Google Scholar'],
  ['github', 'GitHub'],
  ['linkedin', 'LinkedIn'],
  ['orcid', 'ORCID'],
  ['twitter', 'X (Twitter)'],
  ['bluesky', 'Bluesky'],
  ['mastodon', 'Mastodon'],
  ['website', 'Website'],
];

/** Profile links in a fixed order; email is rendered separately as a mailto link. */
export function socialLinks(socials: SocialLinks = {}): { label: string; href: string }[] {
  return SOCIAL_LABELS.flatMap(([key, label]) => {
    const href = socials[key]?.trim();
    return href ? [{ label, href }] : [];
  });
}

// Header priority per site mode; pages not listed rank after these, in nav order.
const NAV_PRIORITY: Record<'personal' | 'lab', string[]> = {
  personal: ['/research', '/publications', '/cv', '/blog', '/talks', '/news', '/projects', '/people', '/positions'],
  lab: ['/research', '/people', '/publications', '/positions', '/join', '/news', '/projects', '/blog', '/talks'],
};

/**
 * Journal header: at most `max` links (Contact included), shown in nav order. Contact is returned on
 * its own so the header can keep it in view on phones; the rest go to the footer index. When `path` is
 * a footer page, it takes the last-ranked header slot so the header always marks where the reader is.
 */
export function splitNav<T extends { href: string }>(nav: T[], siteMode: 'personal' | 'lab', path = '', max = 6) {
  const contact = nav.find((n) => n.href === '/contact');
  const others = nav.filter((n) => n !== contact);
  const rank = (n: T) => {
    const i = NAV_PRIORITY[siteMode].indexOf(n.href);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ranked = [...others].sort((a, b) => rank(a) - rank(b));
  const slots = max - (contact ? 1 : 0);
  const active = ranked.findIndex((n) => n.href !== '/' && (path === n.href || path.startsWith(`${n.href}/`)));
  if (active >= slots && slots > 0) ranked.splice(slots - 1, 0, ...ranked.splice(active, 1));
  const shown = new Set(ranked.slice(0, slots));
  return { primary: others.filter((n) => shown.has(n)), contact, more: others.filter((n) => !shown.has(n)) };
}

export type HomeBlock = 'hero' | 'research' | 'publications' | 'updates';

/**
 * Journal home block order from homepageSections. The hero shows when `hero` or `about` is on
 * (about = the bio inside it); news + blog share one "updates" row placed where the last of them is,
 * so papers listed between them come first. Research, when configured, follows the papers on a
 * personal site (the papers are the proof a visitor came for) and leads on a lab site, where the
 * lab's themes are what prospective students look for first.
 */
export function homeBlocks(
  sections: HomepageSectionId[],
  has: { research: boolean },
  siteMode: 'personal' | 'lab' = 'personal',
): HomeBlock[] {
  const blocks: HomeBlock[] = [];
  if (sections.includes('hero') || sections.includes('about')) blocks.push('hero');
  const lastUpdate = Math.max(sections.lastIndexOf('news'), sections.lastIndexOf('blog'));
  sections.forEach((id, i) => {
    if (id === 'publications') blocks.push('publications');
    if (i === lastUpdate) blocks.push('updates');
  });
  if (has.research) {
    const papers = blocks.indexOf('publications');
    const at = siteMode === 'personal' && papers !== -1 ? papers + 1 : blocks.indexOf('hero') + 1;
    blocks.splice(at, 0, 'research');
  }
  return blocks;
}

/** JSON for <script type="application/ld+json">, with "<" escaped so content can't close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
