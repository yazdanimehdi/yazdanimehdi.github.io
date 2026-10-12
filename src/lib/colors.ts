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
  const darkPrimary = colors?.dark?.primary;
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

/**
 * Journal (editorial) accent from colors.light.primary, and the dark-mode accent from colors.dark.primary.
 * When unset, editorial.css supplies #1F3C88 / #142A63 and #22D3EE / #67E8F9.
 * `html:root[…]` outranks the `:root[…]` defaults in editorial.css, and the doubled `:root` outranks its
 * `html.dark:root[…]` block, regardless of stylesheet order.
 */
export function editorialAccentCss(config: SiteConfig): string {
  const light = config.colors?.light?.primary?.trim();
  const dark = config.colors?.dark?.primary?.trim();
  let css = '';
  if (light) {
    css += `\nhtml:root[data-theme='editorial'] {\n  --ed-accent: ${light};\n  --ed-accent-hover: color-mix(in oklab, ${light}, black 25%);\n  --ed-accent-border: color-mix(in oklab, ${light}, white 75%);\n  --ed-selection: color-mix(in oklab, ${light}, white 84%);\n}`;
  }
  if (dark) {
    css += `\nhtml.dark:root:root[data-theme='editorial'] {\n  --ed-accent: ${dark};\n  --ed-accent-hover: color-mix(in oklab, ${dark}, white 35%);\n}`;
  }
  return css;
}
