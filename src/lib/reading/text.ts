import type { Element, Nodes } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { getDocumentProxy } from 'unpdf';
import type { Passage } from './types';

const fold = (s: string) => s.replace(/\s+/g, ' ').trim();
const classes = (el: Element) => (el.properties.className as string[] | undefined) ?? [];
const DROP = new Set(['script', 'style']);
const BLOCK = new Set(['p', 'div', 'li', 'br']);

/** Visible text: math as `$TeX$`, notes, figures, scripts and styles left out. */
function textOf(n: Nodes): string {
  if (n.type === 'text') return n.value;
  if (n.type === 'element') {
    if (DROP.has(n.tagName) || classes(n).includes('ltx_note')) return '';
    if (n.tagName === 'figure') return ' ';
    if (n.tagName === 'math') return `$${String(n.properties.alttext ?? '')}$`;
    if (BLOCK.has(n.tagName)) return ` ${n.children.map(textOf).join('')} `;
  }
  return 'children' in n ? n.children.map(textOf).join('') : '';
}

const descendants = (n: Nodes, keep: (el: Element) => boolean, out: Element[] = []): Element[] => {
  if ('children' in n)
    for (const c of n.children)
      if (c.type === 'element') {
        if (keep(c)) out.push(c);
        else descendants(c, keep, out);
      }
  return out;
};

/** LaTeXML's arXiv HTML as passages keyed by its own element ids, in reading order. */
export function splitArxivHtml(html: string): Passage[] {
  const out: Passage[] = [];
  const push = (pid: string, kind: Passage['kind'], el: Nodes) => {
    const body = fold(textOf(el));
    if (body) out.push({ pid, kind, body });
  };
  const figure = (el: Element) => {
    const caption = el.children.find((c): c is Element => c.type === 'element' && c.tagName === 'figcaption');
    if (caption) push(String(el.properties.id), 'figure', caption);
  };
  const walk = (n: Nodes, section: string | undefined) => {
    if (n.type !== 'element' && n.type !== 'root') return;
    if (n.type === 'element') {
      const cls = classes(n);
      if (DROP.has(n.tagName) || cls.includes('ltx_note') || cls.includes('ltx_bibliography')) return;
      if (cls.includes('ltx_abstract')) {
        const ps = descendants(n, (el) => el.tagName === 'p' && classes(el).includes('ltx_p'));
        ps.forEach((p, i) => push(`abs.${i + 1}`, 'p', p));
        return;
      }
      if (/^h[234]$/.test(n.tagName) && cls.includes('ltx_title')) {
        if (section) push(section, n.tagName as 'h2' | 'h3' | 'h4', n);
        return;
      }
      if (n.tagName === 'div' && cls.includes('ltx_para') && n.properties.id) {
        push(String(n.properties.id), 'p', n);
        descendants(n, (el) => el.tagName === 'figure' && !!el.properties.id).forEach(figure);
        return;
      }
      if (n.tagName === 'figure' && n.properties.id) return figure(n);
      if (n.tagName === 'section' && n.properties.id) section = String(n.properties.id);
    }
    for (const c of n.children) walk(c, section);
  };
  walk(fromHtml(html), undefined);
  return out;
}

/** One text line; y = transform[5] */
export interface PdfLine {
  text: string;
  y: number;
}

/** Each page's text lines, as pdf.js reads them. Throws on a file pdf.js can't open. */
export async function pdfLines(bytes: Uint8Array): Promise<PdfLine[][]> {
  // pdf.js takes ownership of the buffer it’s given and refuses a Buffer, so hand it a plain Uint8Array copy.
  const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  try {
    const pages: PdfLine[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const { items } = await (await doc.getPage(i)).getTextContent();
      const lines: PdfLine[] = [];
      let text = '';
      let y: number | null = null;
      const end = () => {
        if (text.trim() && y !== null) lines.push({ text: text.trim(), y });
        text = '';
        y = null;
      };
      for (const item of items) {
        if (!('str' in item)) continue;
        if (item.str.trim() && y === null) y = item.transform[5];
        text += item.str;
        if (item.hasEOL) end();
      }
      end();
      pages.push(lines);
    }
    return pages;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** The usual median: the middle value, or the mean of the two middle values. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Paragraphs from PDF lines, 'p<page>.<n>'. A paragraph breaks where the gap to the previous line is wider than
 * 1.5 × the page's median line gap, or where y goes up (the next column).
 */
// ponytail: geometry only, so a heading or a two-column table may run into the paragraph next to it.
export function splitPdfPages(pages: PdfLine[][]): Passage[] {
  const out: Passage[] = [];
  pages.forEach((all, i) => {
    const lines = all.filter((l) => !/^\d+$/.test(l.text.trim()));
    const gaps = lines.slice(1).map((l, j) => lines[j].y - l.y);
    const wide = 1.5 * median(gaps.filter((g) => g > 0));
    const paras: string[] = [];
    lines.forEach((l, j) => {
      const text = l.text.trim();
      if (j === 0 || gaps[j - 1] <= 0 || gaps[j - 1] > wide) return paras.push(text);
      const last = paras[paras.length - 1];
      paras[paras.length - 1] = /-$/.test(last) && /^\p{Ll}/u.test(text) ? last.slice(0, -1) + text : `${last} ${text}`;
    });
    paras.forEach((body, n) => out.push({ pid: `p${i + 1}.${n + 1}`, kind: 'p', body }));
  });
  return out;
}

/** A scan: fewer than 50 non-space characters per page on average. */
export const isScan = (passages: Passage[], pages: number): boolean =>
  passages.reduce((n, p) => n + p.body.replace(/\s/g, '').length, 0) < 50 * pages;
