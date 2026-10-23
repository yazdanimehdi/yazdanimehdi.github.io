// The public Readings and Notes: the published copies, their [[links]] made page links, backlinks and the graph.
import type { z } from 'astro/zod';
import { isPageOn } from './config';
import { getEntries } from './content/index';
import { renderMarkdownDocument } from './markdown';
import { linkKey, mapLinks } from './reading/vault-links';
import type { notesSchema, readingsSchema } from './schemas';

export type NotesData = z.infer<typeof notesSchema>;
export type ReadingsData = z.infer<typeof readingsSchema>;

export interface PublicEntry {
  id: string; // the slug
  kind: 'note' | 'paper';
  data: NotesData | ReadingsData;
  body: string;
  url: string;
}

const PAGES = [
  ['readings', 'paper', '/readings'],
  ['notes', 'note', '/notes'],
] as const;

/** Both collections, only those whose page is on. */
export async function loadPublic(): Promise<PublicEntry[]> {
  const out: PublicEntry[] = [];
  for (const [name, kind, page] of PAGES) {
    if (!isPageOn(page)) continue;
    for (const e of await getEntries(name))
      out.push({ id: e.id, kind, data: e.data, body: e.body ?? '', url: `${page}/${e.id}/` });
  }
  return out;
}

const shown = (l: { target: string; alias: string | null }) => l.alias?.trim() || l.target;
// The shown text goes inside [text](url): escaped, it can't close the link early, open another, or be HTML.
const escapeText = (s: string) => s.replace(/[\\[\]()<]/g, '\\$&');

/** [[T|a]] → [a](url) when T names a public entry (linkKey), else the shown text; then rendered. */
export async function renderPublicBody(e: PublicEntry, all: PublicEntry[]): Promise<string> {
  const urls = new Map(all.map((x) => [linkKey(x.data.title), x.url]));
  const md = mapLinks(e.body, (l) => {
    const url = urls.get(linkKey(l.target));
    return url ? `[${escapeText(shown(l))}](${url})` : escapeText(shown(l));
  });
  return (await renderMarkdownDocument(md)).html;
}

const byTitle = (a: PublicEntry, b: PublicEntry) => a.data.title.localeCompare(b.data.title);

/** The entries whose links include e's id, by title. */
export function backlinksOf(e: PublicEntry, all: PublicEntry[]): PublicEntry[] {
  return all.filter((x) => x.data.links.includes(e.data.id)).sort(byTitle);
}

/** links: in and out; edges: index pairs into nodes, each pair once; a link to an unknown uid is dropped. */
export function publicGraph(all: PublicEntry[]): {
  nodes: { id: string; title: string; kind: 'paper' | 'free'; links: number; href: string }[];
  edges: [number, number][];
} {
  const at = new Map(all.map((e, i) => [e.data.id, i]));
  const links = all.map(() => 0);
  const pairs = new Map<string, [number, number]>();
  all.forEach((e, i) => {
    for (const uid of e.data.links) {
      const j = at.get(uid);
      if (j === undefined || j === i) continue;
      links[i]++;
      links[j]++;
      const pair: [number, number] = [Math.min(i, j), Math.max(i, j)];
      pairs.set(pair.join(), pair);
    }
  });
  return {
    nodes: all.map((e, i) => ({
      id: e.data.id,
      title: e.data.title,
      kind: e.kind === 'paper' ? 'paper' : 'free',
      links: links[i],
      href: e.url,
    })),
    edges: [...pairs.values()],
  };
}

/** Plain text, wikilinks as their shown text, at most `max` characters. */
export function excerpt(markdown: string, max = 280): string {
  const text = mapLinks(markdown, shown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = [...text];
  return cps.length > max
    ? `${cps
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : text;
}
