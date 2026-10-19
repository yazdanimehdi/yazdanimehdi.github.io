import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewsArt, normalizeNight, normalizeTheme } from './config';

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
