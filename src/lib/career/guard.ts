// Ported from ai-job-search tools/posting_guard.py (MIT, (c) 2026 Mads Lorentzen).
// Job-posting text is untrusted: strip hidden content and invisible characters, flag
// instruction-shaped lines and mixed-script look-alikes. Advises; never blocks.
import { fromHtml } from 'hast-util-from-html';
import type { Element, Nodes, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';
import type { GuardFlags } from './types';

const EXCERPT = 120;
const LINE_MAX = 200;

const ZERO_WIDTH = '\u200b\u200c\u200d\u2060\u2061\u2062\u2063\u2064';
const BIDI = '\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
const BIDI_TAMPER = '\u202d\u202e\u2066\u2067\u2068\u2069'; // overrides and isolates
const FORMAT = '\u00ad\u2028\u2029'; // soft hyphen, line/paragraph separators
const BOM = '\ufeff';
const INVISIBLE_SETS = [
  ['zero_width', ZERO_WIDTH],
  ['bidi', BIDI],
  ['format', FORMAT],
  ['bom', BOM],
] as const;
const INVISIBLE = new Set(ZERO_WIDTH + BIDI + FORMAT + BOM);
// Every other format character is stripped and counted as `format`; tag characters ("ASCII smuggling": invisible
// text a model still reads) also count as tampering.
const OTHER_FORMAT = /\p{Cf}/u;
const TAG = /[\u{E0000}-\u{E007F}]/u;

const HIDDEN_STYLE = new RegExp(
  [
    String.raw`display\s*:\s*none`,
    String.raw`visibility\s*:\s*hidden`,
    String.raw`opacity\s*:\s*0(?![.\d]*[1-9])`,
    String.raw`font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?(?![\d.])`,
    String.raw`color\s*:\s*transparent`,
    String.raw`clip\s*:\s*rect\(\s*0`,
    String.raw`clip-path\s*:\s*inset\(\s*100%`,
    String.raw`(?:left|top|text-indent)\s*:\s*-\d{4,}px`,
  ].join('|'),
  'i',
);

const DROP = new Set(['script', 'style', 'noscript', 'svg', 'template']);
const BLOCK = new Set(
  'p div li ul ol h1 h2 h3 h4 h5 h6 tr br section article header footer table thead tbody blockquote pre dd dt dl nav main aside figure form fieldset legend address hr td th option'.split(
    ' ',
  ),
);

// JS \b is ASCII-only; Python's is Unicode. Every \b in the source patterns touches a word character.
const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;
const INSTRUCTION_PATTERNS = [
  `${B}ignore (all|any|the|previous|prior|above|earlier)${E}`,
  String.raw`${B}you are (?:an?|the) (?:ai(?![\p{L}\p{N}_-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)${E}`,
  `${B}system prompt${E}`,
  `${B}do not (tell|inform|mention)( this)? to the user${E}`,
  `${B}(run|execute) the following (command|commands|script|code|shell|instruction|instructions|steps)${E}`,
  String.raw`${B}as an ai(?![\p{L}\p{N}_-])`,
  String.raw`^\s*(assistant|system|user)\s*:`,
  String.raw`<\|`,
  String.raw`\[INST\]`,
  String.raw`###\s*(system|instruction)`,
  `${B}(curl|wget|ssh|scp)${E}`,
  String.raw`\.env${E}`,
  String.raw`settings\.json`,
  `allowed-tools`,
  `${B}tool_use${E}|${B}function_call${E}`,
].map((p) => new RegExp(p, 'iu'));

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const WORD = /[\p{L}\p{N}_]+/gu;
const LATIN = /[A-Za-z]/;
const CONFUSABLE = /[\u0370-\u03ff\u0400-\u04ff]/; // Greek and Cyrillic

const fold = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\xa0\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Remove invisible characters; count them, and count the ones that indicate tampering. */
function cleanText(text: string) {
  const invisible = { zero_width: 0, bidi: 0, format: 0, bom: 0 };
  for (const [key, chars] of INVISIBLE_SETS) for (const c of text) if (chars.includes(c)) invisible[key]++;
  for (const c of text) if (!INVISIBLE.has(c) && OTHER_FORMAT.test(c)) invisible.format++;
  let flagged = 0;
  const chars = Array.from(text);
  chars.forEach((ch, i) => {
    if (BIDI_TAMPER.includes(ch) || TAG.test(ch)) flagged++;
    else if (ZERO_WIDTH.includes(ch) || ch === BOM) {
      // inside a word: a split meant to dodge a scan. A BOM at offset 0 is encoding noise.
      if (/\p{L}/u.test(chars[i - 1] ?? '') && /\p{L}/u.test(chars[i + 1] ?? '')) flagged++;
    }
  });
  return {
    text: fold(
      Array.from(text)
        .filter((c) => !INVISIBLE.has(c) && !OTHER_FORMAT.test(c))
        .join(''),
    ),
    invisible,
    flagged,
  };
}

/** Text content of a subtree, comments included (for scanning what was removed). */
function textOf(node: Nodes): string {
  if (node.type === 'text' || node.type === 'comment') return node.value;
  const kids =
    node.type === 'element' && node.tagName === 'template' && node.content
      ? [node.content]
      : 'children' in node
        ? node.children
        : [];
  return kids.map(textOf).join('');
}

function isHidden(el: Element) {
  const p = el.properties;
  return (
    (p.hidden != null && p.hidden !== false) ||
    String(p.ariaHidden ?? '')
      .trim()
      .toLowerCase() === 'true' ||
    HIDDEN_STYLE.test(String(p.style ?? ''))
  );
}

function cleanHtml(markup: string) {
  const tree: Root = fromHtml(markup, { fragment: true });
  // Pass 1: block elements end lines (leading and trailing newline, as the tag walker emitted).
  visit(tree, 'element', (el) => {
    if (!BLOCK.has(el.tagName)) return;
    el.children.unshift({ type: 'text', value: '\n' });
    if (el.tagName !== 'br' && el.tagName !== 'hr') el.children.push({ type: 'text', value: '\n' });
  });
  const visible: string[] = [];
  const hiddenParts: string[] = [];
  const hiddenBlocks: string[] = [];
  visit(tree, (node) => {
    if (node.type === 'text') visible.push(node.value);
    else if (node.type === 'comment') hiddenParts.push(node.value);
    else if (node.type === 'element') {
      if (DROP.has(node.tagName)) hiddenParts.push(textOf(node));
      else if (isHidden(node)) {
        const block = fold(textOf(node));
        if (block) {
          hiddenBlocks.push(block.slice(0, EXCERPT));
          hiddenParts.push(block);
        }
      } else return;
      return SKIP;
    }
  });
  return { text: fold(visible.join('')), hiddenBlocks, hiddenText: hiddenParts.join('\n') };
}

/** Up to LINE_MAX characters of `line`, always including position `at`, so the quote shows the match. */
function excerpt(line: string, at: number) {
  if (line.length <= LINE_MAX) return line;
  const start = Math.max(0, Math.min(at - Math.floor(LINE_MAX / 3), line.length - LINE_MAX));
  const end = start + LINE_MAX;
  return `${start ? '\u2026' : ''}${line.slice(start, end)}${end < line.length ? '\u2026' : ''}`;
}

export function guardPosting(input: string, format: 'html' | 'text'): { text: string; flags: GuardFlags } {
  let raw = input;
  let hiddenText = '';
  let hiddenBlocks: string[] = [];
  if (format === 'html') {
    let h;
    try {
      h = cleanHtml(input);
    } catch (cause) {
      // Pathological nesting overflows the recursive walkers. Fail closed rather than pass the markup through.
      if (cause instanceof RangeError) throw new Error('Posting HTML is nested too deeply to scan', { cause });
      throw cause;
    }
    raw = h.text;
    hiddenText = h.hiddenText;
    hiddenBlocks = h.hiddenBlocks;
  }
  const { text, invisible, flagged } = cleanText(raw);
  const hidden = cleanText(hiddenText).text;

  const seen = new Set<string>();
  const instructionLines: string[] = [];
  for (const line of [...text.split('\n'), ...hidden.split('\n')]) {
    const s = line.trim();
    if (!s || seen.has(s)) continue;
    const m = INSTRUCTION_PATTERNS.map((p) => p.exec(s)).find(Boolean);
    if (m) {
      seen.add(s);
      instructionLines.push(excerpt(s, m.index));
    }
  }

  const visibleUrls = new Set(text.match(URL_RE));
  const hiddenUrls = [...new Set(hidden.match(URL_RE) ?? [])].filter((u) => !visibleUrls.has(u));
  const mixedScript = [
    ...new Set((`${text}\n${hidden}`.match(WORD) ?? []).filter((w) => LATIN.test(w) && CONFUSABLE.test(w))),
  ];

  return {
    text,
    flags: {
      hiddenBlocks,
      hiddenUrls,
      invisible,
      invisibleFlagged: flagged,
      instructionLines,
      mixedScript,
      warn: instructionLines.length > 0 || flagged > 0 || mixedScript.length > 0,
    },
  };
}
