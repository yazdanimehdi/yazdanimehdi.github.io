import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheme } from './config';

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
