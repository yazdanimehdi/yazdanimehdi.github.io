import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NIGHT_HOVER,
  NIGHT_PALETTES,
  clampNightAccent,
  editorialAccentCss,
  generateColorOverrides,
  type NightPalette,
} from './colors';
import type { SiteConfig } from './types';

const site = (primary?: string) => ({ colors: { light: { primary } } }) as unknown as SiteConfig;

test('editorialAccentCss: nothing when no primary color is set', () => {
  assert.equal(editorialAccentCss(site()), '');
  assert.equal(editorialAccentCss(site('  ')), '');
});

test('editorialAccentCss: accent plus darkened hover from colors.light.primary', () => {
  const css = editorialAccentCss(site('#2c5282'));
  assert.match(css, /html:root\[data-theme='editorial'\] \{/);
  assert.match(css, /--ed-accent: #2c5282;/);
  assert.match(css, /--ed-accent-hover: color-mix\(in oklab, #2c5282, black 25%\);/);
  assert.match(css, /--ed-accent-border: color-mix\(in oklab, #2c5282, white 75%\);/);
  assert.match(css, /--ed-selection: color-mix\(in oklab, #2c5282, white 84%\);/);
});

test('editorialAccentCss: dark accent plus lightened hover from colors.dark.primary, only in dark mode', () => {
  const css = editorialAccentCss({ colors: { dark: { primary: '#22d3ee' } } } as unknown as SiteConfig);
  assert.match(css, /html\.dark:root:root\[data-theme='editorial'\] \{/);
  assert.match(css, /--ed-accent: #22d3ee;/);
  assert.match(css, /--ed-accent-hover: color-mix\(in oklab, #22d3ee, white 35%\);/);
  assert.doesNotMatch(css, /^html:root/m);
});

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test("NIGHT_HOVER mirrors each palette's --ed-hover in editorial.css", () => {
  const css = fs.readFileSync('src/themes/editorial/editorial.css', 'utf8');
  const block = (night: NightPalette) => {
    const head =
      night === 'lamplight'
        ? "html.dark:root[data-theme='editorial'] {"
        : `html.dark:root[data-theme='editorial']:where([data-night='${night}']) {`;
    const start = css.indexOf(head);
    assert.ok(start >= 0, `no block for ${night}`);
    return css.slice(start, css.indexOf('\n}\n', start));
  };
  for (const night of NIGHT_PALETTES) {
    assert.equal(/--ed-hover: (#[0-9a-f]{6});/.exec(block(night))?.[1], NIGHT_HOVER[night], night);
  }
});

test('clampNightAccent: a dark owner accent is lifted to 4.5:1 on each palette Hover; passing and non-hex values are kept', () => {
  for (const night of NIGHT_PALETTES) {
    const hover = NIGHT_HOVER[night];
    for (const owner of ['#1f3c88', '#000000', '#a12a2a', '#2c5282', '#6b21a8', '#008']) {
      const lifted = clampNightAccent(owner, night);
      assert.ok(ratio(lifted, hover) >= 4.5, `${night}: ${owner} -> ${lifted}`);
      assert.ok(ratio(lifted, hover) < 4.7, `${night}: ${owner} -> ${lifted} is lifted no further than needed`);
    }
    for (const kept of ['#9cb1dd', '#a0b6ef', '#86c0c6', '#22d3ee', 'rebeccapurple']) {
      assert.equal(clampNightAccent(kept, night), kept, `${night}: ${kept}`);
    }
  }
});

test('editorialAccentCss: the dark owner accent is clamped against the chosen night palette', () => {
  const css = (night?: NightPalette) =>
    editorialAccentCss({ colors: { dark: { primary: '#1f3c88' } }, editorial: { night } } as unknown as SiteConfig);
  assert.match(css(), /--ed-accent: #(?!1f3c88)/);
  assert.equal(css(), css('lamplight'));
  for (const night of NIGHT_PALETTES) {
    const accent = /--ed-accent: (#[0-9a-f]{6});/.exec(css(night))![1];
    assert.equal(accent, clampNightAccent('#1f3c88', night));
  }
});

test('generateColorOverrides: dark text tokens mix in oklab (oklch reads a near-neutral bg as hue 0, tinting it pink)', () => {
  const css = generateColorOverrides({ background: { dark: { color: '#0d1117' } } } as unknown as SiteConfig);
  assert.match(css, /--color-dm-faint: color-mix\(in oklab, #0d1117, white 54%\);/);
  assert.doesNotMatch(css, /in oklch/);
});

test('generateColorOverrides: classic keeps its cyan dark accent when the owner sets no dark.primary', () => {
  const css = generateColorOverrides({ colors: {} } as unknown as SiteConfig);
  assert.match(css, /html\.dark \{[^}]*--color-accent-600: #22d3ee;/);
});
