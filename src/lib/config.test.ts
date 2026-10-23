import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageOn, normalizeNewsArt, normalizeNight, normalizeTheme } from './config';
import type { SiteConfig } from './types';

test('normalizeTheme: missing or empty means classic', () => {
  for (const value of [undefined, null, '']) assert.equal(normalizeTheme(value, 'config/site.yml'), 'classic');
});

test('normalizeTheme: accepts every theme name; journal and editorial are one theme', () => {
  assert.equal(normalizeTheme('classic', 'config/site.yml'), 'classic');
  assert.equal(normalizeTheme('journal', 'config/site.yml'), 'editorial');
  assert.equal(normalizeTheme('editorial', 'config/site.yml'), 'editorial');
});

test('normalizeTheme: rejects unknown names and says where they came from', () => {
  assert.throws(
    () => normalizeTheme('Editorial', 'SCHOLAROS_THEME'),
    /SCHOLAROS_THEME: theme must be 'journal' or 'classic', got 'Editorial'/,
  );
});

test('normalizeNight: missing or empty means lamplight; the three palettes pass; anything else names its source', () => {
  for (const value of [undefined, null, '']) assert.equal(normalizeNight(value, 'config/site.yml'), 'lamplight');
  for (const value of ['lamplight', 'inkwell', 'galley']) assert.equal(normalizeNight(value, 'config/site.yml'), value);
  assert.throws(
    () => normalizeNight('Ink Well', 'config/site.yml'),
    /config\/site.yml: editorial.night must be one of lamplight, inkwell, galley, got 'Ink Well'/,
  );
});

test('normalizeNewsArt: missing or empty follows the theme; the four styles pass; anything else names its source', () => {
  for (const value of [undefined, null, '']) {
    assert.equal(normalizeNewsArt(value, 'editorial', 'config/site.yml'), 'ink');
    assert.equal(normalizeNewsArt(value, 'classic', 'config/site.yml'), 'geometric');
  }
  for (const value of ['ink', 'engraving', 'watercolor', 'geometric']) {
    assert.equal(normalizeNewsArt(value, 'classic', 'config/site.yml'), value);
  }
  assert.throws(() => normalizeNewsArt('Water Color', 'editorial', 'config/site.yml'), /config\/site.yml: newsArt/);
});

test('isPageOn: a page turned off is off with everything under it; other pages and look-alike paths stay on', () => {
  const config = { pages: { blog: false, cv: true } } as unknown as SiteConfig;
  for (const path of ['/blog', '/blog/', '/blog/a-post', '/blog/tag/ml'])
    assert.equal(isPageOn(path, config), false, path);
  for (const path of ['/', '/cv', '/blogroll', '/news', '/publications'])
    assert.equal(isPageOn(path, config), true, path);
  assert.equal(isPageOn('/blog', {} as SiteConfig), true, 'absent means on');
});

test('isPageOn: readings and notes are off until turned on; other pages stay on when absent', () => {
  assert.equal(isPageOn('/notes', { pages: {} }), false);
  assert.equal(isPageOn('/readings/a-paper/', {}), false);
  assert.equal(isPageOn('/notes/x/', { pages: { notes: true } }), true);
  assert.equal(isPageOn('/readings', { pages: { notes: true } }), false, 'one switch at a time');
  assert.equal(isPageOn('/blog', { pages: {} }), true);
  assert.equal(isPageOn('/notesy', { pages: {} }), true, 'a look-alike path is not under /notes');
});
