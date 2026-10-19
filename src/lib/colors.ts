import type { SiteConfig } from './types';

/**
 * Generate a full primary palette from a single hex color using CSS color-mix().
 * Returns an object of shade → CSS expression pairs.
 */
function palette(hex: string, prefix: string): Record<string, string> {
  // Shade → white-mix percentage (how much white to mix in)
  const shades: Record<number, number> = {
    50: 95,
    100: 90,
    200: 75,
    300: 55,
    400: 35,
    500: 15,
    600: 0, // base color
    700: 0, // darken
    800: 0,
    900: 0,
    950: 0,
  };
  // Shade → black-mix percentage (how much black to mix in) for darker shades
  const darkShades: Record<number, number> = {
    700: 12,
    800: 25,
    900: 38,
    950: 50,
  };

  const result: Record<string, string> = {};
  for (const [shade, whitePct] of Object.entries(shades)) {
    const s = Number(shade);
    if (s <= 600) {
      if (s === 600) {
        result[`--color-${prefix}-${shade}`] = hex;
      } else {
        result[`--color-${prefix}-${shade}`] = `color-mix(in oklab, ${hex}, white ${whitePct}%)`;
      }
    } else {
      const blackPct = darkShades[s] ?? 0;
      result[`--color-${prefix}-${shade}`] = `color-mix(in oklab, ${hex}, black ${blackPct}%)`;
    }
  }
  return result;
}

/**
 * Generate CSS variable overrides from site config colors/background settings.
 * Returns a CSS string to inject in <head>, or empty string if defaults are used.
 */
export function generateColorOverrides(config: SiteConfig): string {
  const colors = config.colors;
  const bg = config.background;

  const parts: string[] = [];

  // ── Light mode overrides ──
  const lightPrimary = colors?.light?.primary;
  const lightSecondary = colors?.light?.secondary;
  const lightBgColor = bg?.light?.color;
  const lightBgImage = bg?.light?.image;

  const lightVars: string[] = [];

  if (lightPrimary) {
    for (const [prop, val] of Object.entries(palette(lightPrimary, 'primary'))) {
      lightVars.push(`  ${prop}: ${val};`);
    }
  }
  if (lightSecondary) {
    for (const [prop, val] of Object.entries(palette(lightSecondary, 'accent'))) {
      lightVars.push(`  ${prop}: ${val};`);
    }
  }

  if (lightVars.length > 0) {
    parts.push(`:root {\n${lightVars.join('\n')}\n}`);
  }

  // Light body background
  const lightBodyParts: string[] = [];
  if (lightBgColor) {
    lightBodyParts.push(`  background-color: ${lightBgColor};`);
  }
  if (lightBgImage) {
    lightBodyParts.push(`  background-image: url('${lightBgImage}');`);
    lightBodyParts.push('  background-size: cover;');
    lightBodyParts.push('  background-position: center;');
    lightBodyParts.push('  background-attachment: fixed;');
  }
  if (lightBodyParts.length > 0) {
    parts.push(`body {\n${lightBodyParts.join('\n')}\n}`);
  }

  // ── Dark mode overrides ──
  // Classic's dark accent when the owner sets none; the journal's dark block overrides these.
  const darkPrimary = colors?.dark?.primary || '#22d3ee';
  const darkSecondary = colors?.dark?.secondary;
  const darkBgColor = bg?.dark?.color;
  const darkBgImage = bg?.dark?.image;

  const darkVars: string[] = [];

  if (darkPrimary) {
    // In dark mode, the "primary" config color maps to the accent palette
    for (const [prop, val] of Object.entries(palette(darkPrimary, 'accent'))) {
      darkVars.push(`  ${prop}: ${val};`);
    }
  }
  if (darkSecondary) {
    // In dark mode, the "secondary" config color maps to the primary palette
    for (const [prop, val] of Object.entries(palette(darkSecondary, 'primary'))) {
      darkVars.push(`  ${prop}: ${val};`);
    }
  }

  // Derive dm-* tokens from dark background color
  if (darkBgColor) {
    darkVars.push(`  --color-dm: ${darkBgColor};`);
    darkVars.push(`  --color-dm-alt: color-mix(in oklab, ${darkBgColor}, white 5%);`);
    darkVars.push(`  --color-dm-hover: color-mix(in oklab, ${darkBgColor}, white 8%);`);
    darkVars.push(`  --color-dm-heading: color-mix(in oklab, ${darkBgColor}, white 92%);`);
    darkVars.push(`  --color-dm-text: color-mix(in oklab, ${darkBgColor}, white 78%);`);
    darkVars.push(`  --color-dm-muted: color-mix(in oklab, ${darkBgColor}, white 62%);`);
    darkVars.push(`  --color-dm-faint: color-mix(in oklab, ${darkBgColor}, white 54%);`);
    darkVars.push(`  --color-dm-border: color-mix(in oklab, ${darkBgColor}, white 12%);`);
    darkVars.push(`  --color-dm-border-alt: color-mix(in oklab, ${darkBgColor}, white 18%);`);
  }

  if (darkVars.length > 0) {
    parts.push(`html.dark {\n${darkVars.join('\n')}\n}`);
  }

  // Dark body background
  const darkBodyParts: string[] = [];
  if (darkBgColor) {
    darkBodyParts.push(`  background-color: ${darkBgColor};`);
  }
  if (darkBgImage) {
    darkBodyParts.push(`  background-image: url('${darkBgImage}');`);
    darkBodyParts.push('  background-size: cover;');
    darkBodyParts.push('  background-position: center;');
    darkBodyParts.push('  background-attachment: fixed;');
  }
  if (darkBodyParts.length > 0) {
    parts.push(`html.dark body {\n${darkBodyParts.join('\n')}\n}`);
  }

  return parts.join('\n');
}

/** The journal's night palettes, chosen by editorial.night. Lamplight is the default. */
export const NIGHT_PALETTES = ['lamplight', 'inkwell', 'galley'] as const;
export type NightPalette = (typeof NIGHT_PALETTES)[number];

/**
 * Each night palette's Hover (`--ed-hover`), the lightest surface accent text sits on in dark mode (row
 * hover; the contact band, a step lighter, carries no accent text). Mirrors the palette blocks in editorial.css; colors.test.ts asserts they match.
 */
export const NIGHT_HOVER: Record<NightPalette, string> = {
  lamplight: '#27231e',
  inkwell: '#1e2230',
  galley: '#272623',
};

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Lifts an owner's dark-mode accent toward white until it clears 4.5:1 on the palette's Hover, so links,
 * venue tiles and the focus ring stay AA on every night surface. Values that already pass, and anything
 * that is not a 3- or 6-digit hex, are returned unchanged.
 */
export function clampNightAccent(color: string, night: NightPalette): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const hex = m[1].length === 3 ? `#${[...m[1]].map((c) => c + c).join('')}` : color;
  const base = channels(hex);
  const floor = 4.5 * (luminance(channels(NIGHT_HOVER[night])) + 0.05) - 0.05;
  if (luminance(base) >= floor) return color;
  for (let p = 1; p <= 100; p++) {
    // Measured after rounding to 8-bit channels: the emitted hex is what has to pass.
    const rgb = base.map((c) => Math.round((c + (1 - c) * (p / 100)) * 255));
    if (luminance(rgb.map((c) => c / 255)) >= floor)
      return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }
  return '#ffffff';
}

/**
 * Journal (editorial) accent from colors.light.primary, and the dark-mode accent from colors.dark.primary
 * (lifted by clampNightAccent for the chosen night palette). When unset, editorial.css supplies the defaults.
 * `html:root[…]` outranks the `:root[…]` defaults in editorial.css, and the doubled `:root` outranks its
 * `html.dark:root[…]` block, regardless of stylesheet order.
 */
export function editorialAccentCss(config: SiteConfig): string {
  const light = config.colors?.light?.primary?.trim();
  const owner = config.colors?.dark?.primary?.trim();
  const dark = owner && clampNightAccent(owner, config.editorial?.night ?? 'lamplight');
  let css = '';
  if (light) {
    css += `\nhtml:root[data-theme='editorial'] {\n  --ed-accent: ${light};\n  --ed-accent-hover: color-mix(in oklab, ${light}, black 25%);\n  --ed-accent-border: color-mix(in oklab, ${light}, white 75%);\n  --ed-selection: color-mix(in oklab, ${light}, white 84%);\n}`;
  }
  if (dark) {
    css += `\nhtml.dark:root:root[data-theme='editorial'] {\n  --ed-accent: ${dark};\n  --ed-accent-hover: color-mix(in oklab, ${dark}, white 35%);\n}`;
  }
  return css;
}
