/**
 * Hero background patterns: one seamless SVG tile each, used as a mask, so any color or gradient can fill the lines.
 * Both themes draw them; each passes its own ink and accent so `color: ''` and `'accent'` follow light and dark mode.
 */
import type { HeroPatternConfig } from './types';

const r = (v: number) => Math.round(v * 100) / 100;

/** A sine line across a tile `w` wide, periodic so neighboring tiles join without a seam. */
function sine(w: number, y: number, amp: number, cycles: number, phase = 0, steps = 32): string {
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI * cycles + phase;
    return `${r((w * i) / steps)} ${r(y + amp * Math.sin(t))}`;
  });
  return `M${points.join('L')}`;
}

const HEX = 'M14 0v8L0 16v16l14 8 14-8V16L14 8M14 48v-8';
const dot = (cx: number, cy: number, radius: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="black" stroke="none"/>`;
const spark = (x: number, y: number, s: number) =>
  `<path fill="black" stroke="none" d="M${x} ${y - s}L${r(x + s * 0.22)} ${r(y - s * 0.22)}L${x + s} ${y}L${r(x + s * 0.22)} ${r(y + s * 0.22)}L${x} ${y + s}L${r(x - s * 0.22)} ${r(y + s * 0.22)}L${x - s} ${y}L${r(x - s * 0.22)} ${r(y - s * 0.22)}Z"/>`;

const helixRungs = Array.from({ length: 8 }, (_, i) => {
  const x = 4 + i * 8;
  const off = 10 * Math.sin((2 * Math.PI * x) / 64);
  return `M${x} ${r(16 - off)}V${r(16 + off)}`;
}).join('');

/** Each tile: width, height and its SVG body, drawn with 1px black strokes unless a shape says otherwise. */
export const HERO_PATTERNS = {
  grid: { w: 28, h: 28, body: '<path d="M28 .5H.5V28"/>' },
  dots: { w: 22, h: 22, body: dot(11, 11, 1.1) },
  diagonal: { w: 18, h: 18, body: '<path d="M-2 20 20-2"/>' },
  waves: { w: 48, h: 16, body: '<path d="M0 8c6-6 18-6 24 0s18 6 24 0"/>' },
  hexagons: { w: 28, h: 48, body: `<path d="${HEX}"/>` },
  crosses: { w: 24, h: 24, body: '<path d="M12 8v8M8 12h8"/>' },
  triangles: { w: 32, h: 28, body: '<path d="M0 27.5 16 .5l16 27Z"/>' },
  zigzag: { w: 24, h: 12, body: '<path d="M0 9 6 3l6 6 6-6 6 6"/>' },
  rings: { w: 32, h: 32, body: '<circle cx="16" cy="16" r="9"/>' },
  scales: {
    w: 24,
    h: 24,
    body: '<path d="M0 12a12 12 0 0 1 24 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0"/>',
  },
  topography: {
    w: 160,
    h: 80,
    body: `<path d="${sine(160, 10, 6, 1)}${sine(160, 30, 8, 2, 1.2)}${sine(160, 50, 7, 1, 2.4)}${sine(160, 70, 5, 2, 3.6)}"/>`,
  },
  helix: { w: 64, h: 32, body: `<path d="${sine(64, 16, 10, 1)}${sine(64, 16, -10, 1)}${helixRungs}"/>` },
  circuit: {
    w: 48,
    h: 48,
    body:
      '<path d="M0 12h14l6 6h10l6-6h12M8 0v26l6 6v10l-6 6M30 18v12M24 48v-8l8-8h8M24 0v4"/>' +
      '<circle cx="30" cy="32.5" r="2.5"/><circle cx="42.5" cy="32" r="2.5"/><circle cx="24" cy="6.5" r="2.5"/>' +
      dot(14, 12, 1.6),
  },
  molecules: {
    w: 28,
    h: 48,
    body: `<path d="${HEX}"/>${dot(14, 8, 1.8)}${dot(0, 16, 1.8)}${dot(0, 32, 1.8)}${dot(14, 40, 1.8)}${dot(28, 32, 1.8)}${dot(28, 16, 1.8)}`,
  },
  cubes: { w: 28, h: 48, body: `<path d="${HEX}M14 24 0 16M14 24l14-8M14 24v16"/>` },
  stipple: {
    w: 40,
    h: 40,
    body: [
      [4, 6, 0.9],
      [17, 3, 0.6],
      [29, 9, 1.2],
      [9, 19, 0.7],
      [23, 22, 1],
      [36, 26, 0.6],
      [5, 33, 1.1],
      [18, 36, 0.7],
      [31, 37, 0.9],
    ]
      .map(([x, y, s]) => dot(x, y, s))
      .join(''),
  },
  sparkles: { w: 48, h: 48, body: `${spark(12, 14, 5)}${spark(36, 34, 3.5)}${dot(36, 10, 0.9)}${dot(10, 38, 0.9)}` },
} as const satisfies Record<string, { w: number; h: number; body: string }>;

export type HeroPatternName = keyof typeof HERO_PATTERNS;
export const HERO_PATTERN_NAMES = Object.keys(HERO_PATTERNS) as HeroPatternName[];

export const HERO_PATTERN_STRENGTH = { subtle: 0.07, medium: 0.14, strong: 0.24 } as const;
export type HeroPatternStrength = keyof typeof HERO_PATTERN_STRENGTH;

/** The tile as a CSS url(); an unknown name draws the grid. */
export function patternMask(name: string | undefined): string {
  const tile = HERO_PATTERNS[(name ?? '') as HeroPatternName] ?? HERO_PATTERNS.grid;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile.w}" height="${tile.h}"><g fill="none" stroke="black" stroke-width="1">${tile.body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// A hex, a named color, or rgb()/hsl()/oklch() with plain numbers: never anything that could leave the declaration.
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|rgba|hsl|hsla|oklch|oklab)\([\d.,%\s/+-]+\))$/i;

/**
 * A theme's colors for patterns, as CSS: its text (ink), its accent, and with brand colors set, the brand
 * secondary, which also makes the brand gradient the default fill.
 */
export interface PatternTheme {
  ink: string;
  accent: string;
  secondary?: string;
}

/** A configured color as CSS: '' → ink, 'accent' / 'secondary' → the theme's, anything unsafe → ink. */
export function patternColor(value: string | undefined, theme: PatternTheme): string {
  const v = value?.trim() ?? '';
  if (!v || !COLOR.test(v)) return theme.ink;
  const word = v.toLowerCase();
  if (word === 'accent') return theme.accent;
  if (word === 'secondary') return theme.secondary ?? theme.accent;
  return v;
}

/** The custom properties a hero pattern element reads: its mask, its fill (a color or gradient) and its strength. */
export function patternStyle(p: HeroPatternConfig | undefined, theme: PatternTheme): string {
  const angle = Number.isFinite(Number(p?.angle)) && p?.angle !== undefined ? Number(p.angle) : 135;
  const color = p?.color?.trim();
  const color2 = p?.color2?.trim();
  const from = patternColor(color, theme);
  // Nothing chosen and brand colors set: the brand gradient, accent to secondary.
  const fill =
    !color && !color2 && theme.secondary
      ? `linear-gradient(${angle}deg, ${theme.accent}, ${theme.secondary})`
      : color2
        ? `linear-gradient(${angle}deg, ${from}, ${patternColor(color2, theme)})`
        : from;
  const opacity = HERO_PATTERN_STRENGTH[p?.strength as HeroPatternStrength] ?? HERO_PATTERN_STRENGTH.subtle;
  return `--hero-pattern: ${patternMask(p?.name)}; --hero-pattern-fill: ${fill}; --hero-pattern-opacity: ${opacity};`;
}
