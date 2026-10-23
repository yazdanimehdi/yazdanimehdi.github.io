// Pure link and title text for the vault; the browser imports it too. Migration 010's vault_title mirrors noteTitle.

/** Characters a file name (Windows, macOS, Obsidian links) can't hold, and control characters. */
const BAD = /[\\/:*?"<>|#^[\]\p{Cc}]/gu;
/** A [[link]]: its `!`, target, and `#heading` or `|alias`. */
const LINK = /(!?)\[\[([^\][|#\n]+)((?:[#|][^\]\n]*)?)\]\]/g;

const ends = (s: string) => s.replace(/^[ .]+|[ .]+$/g, '');
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The first 100 - k code points, or 50 - k when those are over 200 - k UTF-8 bytes; ends trimmed. */
function fit(s: string, k: number): string {
  const cps = [...s];
  const t = cps.slice(0, 100 - k).join('');
  return ends(new TextEncoder().encode(t).length > 200 - k ? cps.slice(0, 50 - k).join('') : t);
}

/** A title that is a file name: at most 100 characters and 200 bytes, never empty. */
export function noteTitle(raw: string): string {
  return fit(ends(raw.replace(BAD, ' ').replace(/\s+/g, ' ')), 0) || 'Untitled';
}

/** `title (n)`, its base trimmed so the whole still fits noteTitle's cap. `title` is already a noteTitle. */
export function numberedTitle(title: string, n: number): string {
  const suffix = ` (${n})`;
  return fit(title, suffix.length) + suffix;
}

/** The body's link targets, whitespace collapsed, unique, in order. */
export function wikiLinks(body: string): string[] {
  return [...new Set([...body.matchAll(LINK)].map((m) => collapse(m[2])).filter(Boolean))];
}

/** Every link to `from` (case and whitespace runs ignored) now names `to`, keeping its `!`, heading and alias. */
export function rewriteLinks(body: string, from: string, to: string): string {
  const key = collapse(from).toLowerCase();
  return body.replace(LINK, (all, bang: string, target: string, rest: string) =>
    collapse(target).toLowerCase() === key ? `${bang}[[${to}${rest}]]` : all,
  );
}

/** Adds `[[title]]` to the body's (last) `Related:` line wherever it is, starting one at the end when there is none. */
export function addRelated(body: string, title: string): string {
  const b = body.trimEnd();
  const lines = b.split('\n');
  const at = lines.findLastIndex((l) => l.startsWith('Related: '));
  if (at >= 0) {
    lines[at] += `, [[${title}]]`;
    return lines.join('\n');
  }
  return b ? `${b}\n\nRelated: [[${title}]]` : `Related: [[${title}]]`;
}
