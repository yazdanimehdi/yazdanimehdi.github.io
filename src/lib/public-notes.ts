// The public Readings and Notes: the published copies, their [[links]] made page links, backlinks and the graph.
import type { z } from 'astro/zod';
import { stringify } from 'yaml';
import { isPageOn } from './config';
import { getEntries } from './content/index';
import { renderMarkdownDocument } from './markdown';
import { EXPORT_MAX } from './reading/limits';
import { linkKey, mapLinks } from './reading/vault-links';
import { zip } from './reading/vault-zip';
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

/** /notes/graph.json: the open format other sites' importers read. A change to it is a new `version`. */
export interface GraphDocument {
  format: 'scholaros-notes';
  version: 1;
  site: { name: string; url: string; owner: string }; // url: no trailing slash
  notes: {
    id: string;
    kind: 'note' | 'paper';
    title: string;
    url: string; // absolute
    shared: string;
    updated: string;
    body: string; // the copy's body: [[links]] to public notes only
    paper?: { title: string; authors: string[]; url: string; arxiv?: string; doi?: string; published?: string };
    highlights?: { quote: string; where: string; comment?: string }[];
  }[];
  links: [string, string][]; // [from id, to id], each once, both ends present in notes
}

/** Notes by title, links sorted; a link to an unknown uid is dropped. */
export function graphDocument(all: PublicEntry[], site: GraphDocument['site']): GraphDocument {
  const ids = new Set(all.map((e) => e.data.id));
  const links = new Map<string, [string, string]>();
  for (const e of all)
    for (const uid of e.data.links)
      if (ids.has(uid) && uid !== e.data.id) links.set(`${e.data.id} ${uid}`, [e.data.id, uid]);
  return {
    format: 'scholaros-notes',
    version: 1,
    site,
    notes: [...all].sort(byTitle).map((e) => {
      const d = e.data;
      const note: GraphDocument['notes'][number] = {
        id: d.id,
        kind: e.kind,
        title: d.title,
        url: site.url + e.url,
        shared: d.shared.toISOString(),
        updated: d.updated.toISOString(),
        body: e.body,
      };
      if (d.kind === 'paper') {
        const { published, ...paper } = d.paper;
        note.paper = { ...paper, ...(published ? { published: published.toISOString() } : {}) };
        note.highlights = d.highlights;
      }
      return note;
    }),
    links: [...links.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
  };
}

/** The Obsidian folder: each copy under its vault title, so [[links]] resolve; `source:` is its public page. */
export function publicZipFiles(all: PublicEntry[], siteUrl: string): { path: string; text: string; date: Date }[] {
  return all.map((e) => {
    // Through JSON: Dates become ISO strings. id and kind first, as in the copy.
    const d = JSON.parse(JSON.stringify(e.data)) as Record<string, unknown>;
    const fm = { id: d.id, kind: d.kind, ...d, source: siteUrl + e.url };
    return {
      path: `${e.kind === 'paper' ? 'readings' : 'notes'}/${e.data.title}.md`,
      text: `---\n${stringify(fm, { lineWidth: 0 })}---\n\n${e.body}`,
      date: e.data.updated,
    };
  });
}

/** /notes/vault.zip; refused (413) over `max`, never truncated. `filename`: ASCII. */
export function vaultZipResponse(all: PublicEntry[], siteUrl: string, filename: string, max = EXPORT_MAX): Response {
  const out = zip(publicZipFiles(all, siteUrl));
  if (out.byteLength > max)
    return new Response(
      `The notes’ zip is ${(Math.ceil(out.byteLength / 1e5) / 10).toFixed(1)} MB, over the 4.4 MB one download can carry.`,
      { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  return new Response(out as Uint8Array<ArrayBuffer>, {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"` },
  });
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

// What the route files hand both themes' Readings and Notes pages.
export type Paper = ReadingsData['paper'];
export interface Linked {
  title: string;
  href: string;
}
export interface ReadingItem {
  href: string;
  paper: Paper;
  excerpt: string;
  highlights: number;
}
export interface ReadingPage {
  paper: Paper;
  notes: string; // HTML
  highlights: { quote: string; where: string; comment: string }[]; // comment: HTML, '' when none
  backlinks: Linked[];
  description: string;
}
export interface NoteItem extends Linked {
  updated: Date;
}
export interface NotePage {
  title: string;
  updated: Date;
  body: string; // HTML
  backlinks: Linked[];
  description: string;
}
export type GraphData = {
  nodes: { title: string; kind: 'paper' | 'free'; links: number; href: string }[];
  edges: [number, number][];
};
