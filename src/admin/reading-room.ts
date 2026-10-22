import { visible } from '../lib/career/text';
import type { Cite, Highlight, Output, OutputKind, TextState } from '../lib/reading/types';

/** 'S2.p3'; a scan page 'p. 3'; in a notebook (`papers` given) the first author's surname first: 'Vaswani S2.p3'. */
export function citeLabel(c: Cite, papers?: Map<number, { authors: string[] }>): string {
  const page = /^page(\d+)$/.exec(c.pid);
  const label = page ? `p. ${page[1]}` : c.pid;
  const surname = visible(papers?.get(c.paper)?.authors[0] ?? '')
    .trim()
    .split(/\s+/)
    .pop();
  return surname ? `${surname} ${label}` : label;
}

export type Inline = { t: 'text' | 'strong' | 'em' | 'code'; s: string } | { t: 'cite'; cites: Cite[] };
export type Block = { t: 'p' | 'h'; inl: Inline[] } | { t: 'ul' | 'ol'; items: Inline[][] };

/** '12:S2.p3' → { paper: 12, pid: 'S2.p3' } */
const toCite = (id: string): Cite => ({
  paper: Number(id.slice(0, id.indexOf(':'))),
  pid: id.slice(id.indexOf(':') + 1),
});

const IDS = String.raw`\[(\d+:[A-Za-z0-9.]+(?:[,;]\s*\d+:[A-Za-z0-9.]+)*)\]`; // [12:S2.p3, 13:page2]
// **strong** | `code` | cites | *em* | _em_ (not inside a word, so snake_case stays text)
const INLINE = new RegExp(
  String.raw`\*\*(.+?)\*\*|\x60([^\x60]+)\x60|${IDS}|\*([^*\s](?:[^*]*[^*\s])?)\*|(?<![A-Za-z0-9])_([^_\s](?:[^_]*[^_\s])?)_(?![A-Za-z0-9])`,
  'g',
);
const cite = (ids: string): Inline => ({ t: 'cite', cites: ids.split(/[,;]\s*/).map(toCite) });
/** Bold or emphasised text, its cites still cites: split() with one group alternates text and ids. */
const styled = (t: 'strong' | 'em', s: string): Inline[] =>
  s.split(new RegExp(IDS)).flatMap((part, i) => (i % 2 ? [cite(part)] : part ? [{ t, s: part }] : []));

function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ t: 'text', s: s.slice(at, m.index) });
    const [, strong, code, ids, em1, em2] = m;
    if (ids !== undefined) out.push(cite(ids));
    else if (strong !== undefined) out.push(...styled('strong', strong));
    else if (code !== undefined) out.push({ t: 'code', s: code });
    else out.push(...styled('em', em1 ?? em2));
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ t: 'text', s: s.slice(at) });
  return out;
}

/**
 * The small Markdown subset chat answers use: blank-line paragraphs, '- '/'* ' and '1. ' lists (a plain line continues
 * the item above; blank lines between items keep one list), '#' lines as headings, **strong**, *em* or _em_, `code` and [12:S2.p3] cites. Everything else (links,
 * HTML, images) stays literal text: the result is only ever rendered as text nodes.
 */
export function markdownBlocks(md: string): Block[] {
  type Raw = { t: 'p' | 'h'; s: string } | { t: 'ul' | 'ol'; items: string[] };
  const raw: Raw[] = [];
  let open = null as Raw | null; // the block a following line continues
  let blank = false; // a blank line came since `open`: only an item of the same list continues it
  for (const line of md.split(/\r?\n/)) {
    const l = line.trim();
    const head = /^#{1,6}\s+(.*)$/.exec(l);
    const item = /^(?:([-*])|\d{1,9}[.)])\s+(.*)$/.exec(l);
    if (!l) {
      blank = true;
      continue;
    }
    if (head) {
      raw.push({ t: 'h', s: head[1] });
      open = null;
    } else if (item) {
      const t = item[1] ? 'ul' : 'ol';
      if (open?.t !== t) raw.push((open = { t, items: [] }));
      if ('items' in open) open.items.push(item[2]);
    } else if (!blank && open?.t === 'p') open.s += ` ${l}`;
    else if (!blank && (open?.t === 'ul' || open?.t === 'ol')) open.items[open.items.length - 1] += ` ${l}`;
    else raw.push((open = { t: 'p', s: l }));
    blank = false;
  }
  return raw.map((b) => ('items' in b ? { t: b.t, items: b.items.map(inline) } : { t: b.t, inl: inline(b.s) }));
}

/** The body cut at every highlight edge; a piece inside overlapping highlights lists them all. */
export function passageSegments(
  body: string,
  hs: Pick<Highlight, 'id' | 'start' | 'end'>[],
): { s: string; ids: number[] }[] {
  const clamp = (n: number) => Math.max(0, Math.min(body.length, n));
  const edges = [...new Set([0, body.length, ...hs.flatMap((x) => [clamp(x.start), clamp(x.end)])])].sort(
    (a, b) => a - b,
  );
  return edges.slice(1).map((end, i) => ({
    s: body.slice(edges[i], end),
    ids: hs.filter((x) => x.start <= edges[i] && x.end >= end).map((x) => x.id),
  }));
}

/** A selection with both ends inside the same [data-pid] element: offsets in its textContent. Null across passages or empty. */
export function selectionInPassage(sel: Selection): { pid: string; start: number; end: number; quote: string } | null {
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const passage = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('[data-pid]');
  const el = passage(range.startContainer);
  if (!el || el !== passage(range.endContainer)) return null;
  const before = el.ownerDocument.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  const quote = (el.textContent ?? '').slice(start, end);
  return quote ? { pid: el.getAttribute('data-pid')!, start, end, quote } : null;
}

/** The line above the paper's text saying where it came from; null for arXiv's HTML, the normal case. */
export function textLabel(t: TextState): string | null {
  if (t.error)
    return `The full text couldn’t be fetched: ${visible(t.error)}. It is tried again the next time this runs.`;
  switch (t.source) {
    case 'arxiv-html':
      return null;
    case 'arxiv-pdf':
      return 'Text extracted from arXiv’s PDF: equations and tables may read oddly.';
    case 'upload':
      return 'Text extracted from your PDF.';
    case 'scan':
      return 'This PDF is a scan with no text layer, so there is no text to show. The AI reads the page images; citations name a page only.';
    case 'abstract':
      return `Only the abstract is available${t.note ? ` (${visible(t.note)})` : ''}. The summary and chat are grounded on it alone.`;
    default:
      return 'Text not fetched yet';
  }
}

const WRITING: Record<OutputKind, string> = {
  summary: 'summary',
  briefing: 'briefing',
  faq: 'FAQ',
  glossary: 'glossary',
};

/** A running output's progress: waiting on arXiv for the text, then writing. Null when nothing runs. */
export function progressLine(o: Output | undefined, textReady: boolean, notebook: boolean): string | null {
  if (o?.status !== 'running') return null;
  if (textReady) return `Writing the ${WRITING[o.kind]}. This takes up to a minute.`;
  return `Fetching the ${notebook ? 'papers’' : 'paper’s'} text from arXiv. arXiv asks for 15 seconds between fetches, so this can take a minute.`;
}
