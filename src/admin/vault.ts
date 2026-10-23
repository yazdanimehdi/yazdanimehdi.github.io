// Pure helpers for the vault's editor ([[ autocomplete, out-links, the Visibility line) and graph (layout, picking).
import { wikiLinks } from '../lib/reading/vault-links';
import type { NoteRow } from '../lib/reading/types';
import type { Visibility } from '../lib/reading/visibility';

type Point = { x: number; y: number };

/** The open `[[` before the caret (no `]`, `|`, `#` or newline since): `start` is just after it. */
export function linkQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  const query = before.slice(open + 2);
  return /[\]|#\n]/.test(query) ? null : { start: open + 2, query };
}

/** `text[start, caret)` becomes `title]]` (reusing a `]]` already after the caret); the caret lands after the `]]`. */
export function completeLink(
  text: string,
  caret: number,
  start: number,
  title: string,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const closed = after.startsWith(']]');
  const head = `${text.slice(0, start)}${title}]]`;
  return { text: head + (closed ? after.slice(2) : after), caret: head.length };
}

/**
 * Enter or Tab in the editor: the `pick`-th title matching the link open at `caret` now, completed; null when no link
 * is open there or nothing is at `pick`, so the key does its usual thing. Never a link start read before the caret moved.
 */
export function completeAt(
  text: string,
  caret: number,
  notes: NoteRow[],
  self: number,
  pick: number,
): { text: string; caret: number } | null {
  const link = linkQuery(text, caret);
  const row = link && matchTitles(notes, link.query, self)[pick];
  return row ? completeLink(text, caret, link.start, row.title) : null;
}

/** Titles containing the query (case ignored), those starting with it first, each by title; `self` left out. */
export function matchTitles(notes: NoteRow[], query: string, self: number, limit = 8): NoteRow[] {
  const q = query.toLowerCase();
  const rank = (n: NoteRow) => (n.title.toLowerCase().startsWith(q) ? 0 : 1);
  return notes
    .filter((n) => n.id !== self && n.title.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** The body's links in order, each with the id of the note it names (case ignored), or null. */
export function outLinks(body: string, notes: NoteRow[]): { title: string; id: number | null }[] {
  const ids = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
  return wikiLinks(body).map((title) => ({ title, id: ids.get(title.toLowerCase()) ?? null }));
}

const MARGIN = 24;
/** A spring from each node to the centre, so separate clusters don't drift onto the walls and pile up there. */
const GRAVITY = 0.4;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Fruchterman–Reingold from a golden-angle spiral (deterministic). Edges are node indexes.
 * ponytail: O(n²) per step; the 200-node cap keeps it under ~100 ms.
 */
export function layout(n: number, edges: [number, number][], w: number, h: number, iterations = 300): Point[] {
  const cx = w / 2;
  const cy = h / 2;
  const spread = Math.max(0, Math.min(w, h) / 2 - MARGIN);
  const pts = Array.from({ length: n }, (_, i) => {
    const r = spread * Math.sqrt((i + 0.5) / n);
    return { x: cx + r * Math.cos(i * GOLDEN), y: cy + r * Math.sin(i * GOLDEN) };
  });
  // Half the textbook spacing, with gravity, keeps the graph off the walls (where clamping piles it); `fit` fills the box.
  const k = 0.5 * Math.sqrt((w * h) / Math.max(n, 1));
  for (let it = 0; it < iterations; it++) {
    const t = (w / 10) * (1 - it / iterations);
    const dx = new Array<number>(n).fill(0);
    const dy = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ex = pts[i].x - pts[j].x;
        const ey = pts[i].y - pts[j].y;
        const d = Math.hypot(ex, ey) || 0.01;
        const f = (k * k) / d / d;
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }
    for (const [a, b] of edges) {
      const ex = pts[a].x - pts[b].x;
      const ey = pts[a].y - pts[b].y;
      const f = Math.hypot(ex, ey) / k;
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
    }
    for (let i = 0; i < n; i++) {
      const gx = pts[i].x - cx;
      const gy = pts[i].y - cy;
      const f = (GRAVITY * Math.hypot(gx, gy)) / k;
      dx[i] -= gx * f;
      dy[i] -= gy * f;
    }
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(dx[i], dy[i]);
      if (!len) continue;
      const step = Math.min(len, t) / len;
      pts[i].x = Math.min(w - MARGIN, Math.max(MARGIN, pts[i].x + dx[i] * step));
      pts[i].y = Math.min(h - MARGIN, Math.max(MARGIN, pts[i].y + dy[i] * step));
    }
  }
  return fit(pts, w, h);
}

/** Scaled (both axes alike) and centred to fill the box inside the margin. */
function fit(pts: Point[], w: number, h: number): Point[] {
  if (!pts.length) return pts;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const [bw, bh] = [Math.max(...xs) - x0, Math.max(...ys) - y0];
  const s = Math.min(bw ? (w - 2 * MARGIN) / bw : Infinity, bh ? (h - 2 * MARGIN) / bh : Infinity);
  if (!Number.isFinite(s)) return pts;
  const [ox, oy] = [(w - bw * s) / 2, (h - bh * s) / 2];
  return pts.map((p) => ({ x: ox + (p.x - x0) * s, y: oy + (p.y - y0) * s }));
}

/** The index of the point nearest (x, y) within `max`, or null. */
export function nearestNode(pts: Point[], x: number, y: number, max: number): number | null {
  let best: number | null = null;
  let bestD = max;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

export const KIND_NAMES = { paper: 'Paper', chat: 'Chat', free: 'Note' } as const;

/** The Visibility line on a note; `shared` is the reading room's own count of the paper's public highlights. */
export function visibilityText(v: Visibility, kind: 'paper' | 'free', shared?: { on: number; all: number }): string {
  if (v.chat) return "Visibility: private. Chat notes can't be made public.";
  if (!v.public) return 'Visibility: private.';
  const hs = shared ?? v.highlights ?? { on: 0, all: 0 };
  const counts = kind === 'paper' ? `, with ${hs.on} of ${hs.all} highlights` : '';
  const off = v.pageOn ? '' : ` The ${kind === 'paper' ? 'Readings' : 'Notes'} page is off; turn it on in Pages.`;
  return `Visibility: public at ${v.url}${counts}.${off}`;
}
