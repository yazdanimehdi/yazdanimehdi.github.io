import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialAccentCss, generateColorOverrides } from './colors';
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

test('generateColorOverrides: dark text tokens mix in oklab (oklch reads a near-neutral bg as hue 0, tinting it pink)', () => {
  const css = generateColorOverrides({ background: { dark: { color: '#0d1117' } } } as unknown as SiteConfig);
  assert.match(css, /--color-dm-faint: color-mix\(in oklab, #0d1117, white 54%\);/);
  assert.doesNotMatch(css, /in oklch/);
});
