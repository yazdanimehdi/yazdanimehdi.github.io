/**
 * Inline formatting inside CV strings: the Markdown subset RenderCV understands (`**bold**`, `*italic*`,
 * `[text](https://…)`, `\*` for a literal asterisk) plus Pandoc-style font spans, `[text]{.mono}`.
 * Every renderer (site, admin preview, pdfmake) reads `parseInline`; the YAML keeps plain strings.
 */

export type CvFont = 'serif' | 'sans' | 'mono';

export const CV_FONTS: Record<CvFont, { label: string; css: string; pdf: string }> = {
  serif: { label: 'Serif', css: 'var(--font-serif)', pdf: 'Serif' },
  sans: { label: 'Sans', css: 'var(--font-sans)', pdf: 'Sans' },
  mono: { label: 'Mono', css: 'var(--font-mono)', pdf: 'Mono' },
};

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  font?: CvFont;
  href?: string;
}

type Style = Omit<InlineSpan, 'text'>;
/** A run of `*`: `len` as written, `run` still unmatched. */
interface Delim {
  run: number;
  len: number;
  open: boolean;
  close: boolean;
}
type Node = string | Delim | { style: Style; children: Node[] };

const isFont = (f: string | undefined): f is CvFont => !!f && Object.hasOwn(CV_FONTS, f);
const isDelim = (n: Node): n is Delim => typeof n === 'object' && 'run' in n;
/** Links only to the web or mail; anything else (`javascript:`) stays literal text. */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const BRACKET = /^\[([^\]]*)\](?:\{\.(\w+)\}|\(([^()\s]+)\))/;

function tokens(s: string): Node[] {
  const out: Node[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push(text);
    text = '';
  };
  for (let i = 0; i < s.length; ) {
    if (s[i] === '\\' && s[i + 1] === '*') {
      text += '*';
      i += 2;
      continue;
    }
    if (s[i] === '[') {
      const m = BRACKET.exec(s.slice(i));
      const style: Style | null = !m
        ? null
        : isFont(m[2])
          ? { font: m[2] }
          : m[3] && SAFE_URL.test(m[3])
            ? { href: m[3] }
            : null;
      if (m && style) {
        flush();
        out.push({ style, children: emphasis(tokens(m[1])) });
        i += m[0].length;
        continue;
      }
    }
    if (s[i] === '*') {
      let j = i;
      while (s[j] === '*') j++;
      flush();
      const len = j - i;
      out.push({ run: len, len, open: j < s.length && !/\s/.test(s[j]), close: i > 0 && !/\s/.test(s[i - 1]) });
      i = j;
      continue;
    }
    text += s[i++];
  }
  flush();
  return out;
}

/** CommonMark's delimiter matching, simplified: each closer pairs with the nearest opener, `**` before `*`. */
function emphasis(nodes: Node[]): Node[] {
  for (let c = 0; c < nodes.length; c++) {
    const close = nodes[c];
    if (!isDelim(close) || !close.close) continue;
    while (close.run > 0) {
      let o = c - 1;
      while (o >= 0 && !(isDelim(nodes[o]) && (nodes[o] as Delim).open && (nodes[o] as Delim).run > 0)) o--;
      if (o < 0) break;
      const open = nodes[o] as Delim;
      const use = open.run >= 2 && close.run >= 2 ? 2 : 1;
      open.run -= use;
      close.run -= use;
      const style = use === 2 ? { bold: true } : { italic: true };
      nodes.splice(o + 1, c - o - 1, { style, children: nodes.slice(o + 1, c) });
      c = o + 2;
    }
  }
  return nodes;
}

const sameStyle = (a: Style, b: Style) =>
  a.bold === b.bold && a.italic === b.italic && a.font === b.font && a.href === b.href;

function flatten(nodes: Node[], style: Style, out: InlineSpan[]): InlineSpan[] {
  for (const n of nodes) {
    if (typeof n === 'object' && 'style' in n) {
      flatten(n.children, { ...style, ...n.style }, out);
      continue;
    }
    // An unmatched `****` is an empty bold (what the B button leaves on an empty selection): it shows nothing.
    const text = typeof n === 'string' ? n : n.len === 4 && n.run === 4 ? '' : '*'.repeat(n.run);
    if (!text) continue;
    const last = out.at(-1);
    if (last && sameStyle(last, style)) last.text += text;
    else out.push({ text, ...style });
  }
  return out;
}

export function parseInline(s: string): InlineSpan[] {
  return flatten(emphasis(tokens(s)), {}, []);
}

/** The text without markup: list previews, titles, metadata. */
export const plainText = (s: string) =>
  parseInline(s)
    .map((span) => span.text)
    .join('');

// ── Editing (the admin's formatting bar) ──

export type InlineFormat = 'bold' | 'italic' | 'link' | { font: CvFont | null };
export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

const LINK_PLACEHOLDER = 'https://';

/** Unescaped `*` immediately before `i`. */
function starsBefore(v: string, i: number): number {
  let j = i;
  while (j > 0 && v[j - 1] === '*') j--;
  return i - j - (v[j - 1] === '\\' && i > j ? 1 : 0);
}
function starsAfter(v: string, i: number): number {
  let j = i;
  while (v[j] === '*') j++;
  return j - i;
}

function toggleStars(v: string, s: number, e: number, n: 1 | 2): TextEdit {
  const marks = (run: number) => (n === 2 ? run >= 2 : run % 2 === 1);
  if (marks(starsBefore(v, s)) && marks(starsAfter(v, e)))
    return { value: v.slice(0, s - n) + v.slice(s, e) + v.slice(e + n), start: s - n, end: e - n };
  const inner = v.slice(s, e);
  const lead = starsAfter(inner, 0);
  const trail = starsBefore(inner, inner.length);
  if (lead + trail < inner.length && marks(lead) && marks(trail))
    return { value: v.slice(0, s) + inner.slice(n, -n) + v.slice(e), start: s, end: e - 2 * n };
  const m = '*'.repeat(n);
  return { value: v.slice(0, s) + m + inner + m + v.slice(e), start: s + n, end: e + n };
}

const SUFFIX = /^\](?:\{\.(\w+)\}|\([^()\s]*\))/;
const WHOLE = /^\[([^\]]*)\](?:\{\.(\w+)\}|\([^()\s]*\))$/;

/** A `[text]{.font}` or `[text](url)` around (or exactly equal to) the selection. */
function bracketAt(v: string, s: number, e: number) {
  const inner = v.slice(s, e);
  const after = v[s - 1] === '[' && !inner.includes(']') ? SUFFIX.exec(v.slice(e)) : null;
  if (after) return { from: s - 1, to: e + after[0].length, text: inner, font: after[1] };
  const whole = WHOLE.exec(inner);
  return whole ? { from: s, to: e, text: whole[1], font: whole[2] } : null;
}

function toggleBracket(v: string, s: number, e: number, format: 'link' | { font: CvFont | null }): TextEdit {
  const found = bracketAt(v, s, e);
  const replace = (from: number, to: number, text: string, sel: number, selEnd: number): TextEdit => ({
    value: v.slice(0, from) + text + v.slice(to),
    start: from + sel,
    end: from + selEnd,
  });
  const unwrap = (f: NonNullable<typeof found>) => replace(f.from, f.to, f.text, 0, f.text.length);
  const text = v.slice(s, e);
  if (format === 'link') {
    if (found && !found.font) return unwrap(found);
    const at = text.length + 3;
    return replace(s, e, `[${text}](${LINK_PLACEHOLDER})`, at, at + LINK_PLACEHOLDER.length);
  }
  if (found?.font) {
    if (!format.font || format.font === found.font) return unwrap(found);
    return replace(found.from, found.to, `[${found.text}]{.${format.font}}`, 1, found.text.length + 1);
  }
  if (!format.font) return { value: v, start: s, end: e };
  return replace(s, e, `[${text}]{.${format.font}}`, 1, text.length + 1);
}

/**
 * Wraps the selection in the format, or unwraps it when the selection is already exactly wrapped, so a button
 * toggles. The returned selection covers the same text (for a new link, the URL placeholder to type over).
 */
export function toggleFormat(value: string, start: number, end: number, format: InlineFormat): TextEdit {
  // Markers hugging spaces do not parse (`** bold**`), and a double-click often selects a trailing space.
  while (start < end && /\s/.test(value[start])) start++;
  while (end > start && /\s/.test(value[end - 1])) end--;
  if (format === 'bold' || format === 'italic') return toggleStars(value, start, end, format === 'bold' ? 2 : 1);
  return toggleBracket(value, start, end, format);
}
