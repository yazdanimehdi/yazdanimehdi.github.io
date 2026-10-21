import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PathError, assertAllowed } from './admin/paths';
import { affectsCvPdf } from './cv-pdf/generate';
import { assertThemeFiles, defaultStyles, parseStyles } from './cv-styles';
import type { CvConfig } from './types';

const cv = { cv: { name: 'N' } } as unknown as CvConfig;

test('defaultStyles matches the shared fixture', () => {
  const cases = JSON.parse(readFileSync('services/cv-render/fixtures/default-styles.json', 'utf-8'));
  for (const c of cases) assert.deepStrictEqual(defaultStyles(c.input), c.expected);
});

test('parseStyles repairs public', () => {
  const style = (id: string, density = 'normal') =>
    `  - { id: ${id}, name: ${id}, theme: classic, density: ${density}, design: {} }`;
  const parsed = parseStyles(`public: gone\nstyles:\n${style('a')}\n${style('b')}\n`, cv);
  assert.equal(parsed.public, 'a');
  assert.deepStrictEqual(parseStyles('not: [yaml', cv), defaultStyles(cv));
  assert.deepStrictEqual(parseStyles(undefined, cv), defaultStyles(cv));
  const tiny = parseStyles(`public: b\nstyles:\n${style('a')}\n${style('b', 'tiny')}\n`, cv);
  assert.deepStrictEqual(
    tiny.styles.map((s) => s.id),
    ['a'],
  );
  assert.equal(tiny.public, 'a');
  const dup = parseStyles(`styles:\n${style('a')}\n${style('a', 'airy')}\n`, cv);
  assert.deepStrictEqual(
    dup.styles.map((s) => s.density),
    ['normal'],
  );
});

test('parseStyles reads design as YAML text and defaults a missing one', () => {
  const head = 'id: a, name: a, theme: classic, density: normal';
  const text = parseStyles(`styles:\n  - { ${head}, design: "page:\\n  top_margin: 1cm\\n" }\n`, cv);
  assert.deepStrictEqual(text.styles[0].design, { page: { top_margin: '1cm' } });
  assert.deepStrictEqual(parseStyles(`styles:\n  - { ${head} }\n`, cv).styles[0].design, {});
  assert.deepStrictEqual(parseStyles(`styles:\n  - { ${head}, design: "[1, 2]" }\n`, cv), defaultStyles(cv));
  assert.deepStrictEqual(parseStyles(`styles:\n  - { ${head}, design: "a: [" }\n`, cv), defaultStyles(cv));
});

test('assertThemeFiles rejects', () => {
  assertThemeFiles('mine', { 'Header.j2.typ': '' });
  const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}.typ`, '']));
  const bad: [string, Record<string, string>][] = [
    ['mine', { '../x.j2.typ': '' }],
    ['mine', { '__init__.py': '' }],
    ['classic', { 'Header.j2.typ': '' }],
    ['My-Theme', { 'Header.j2.typ': '' }],
    ['mine', { 'Header.j2.typ': 'x'.repeat(600 * 1024) }],
    ['mine', many],
  ];
  for (const [name, files] of bad) assert.throws(() => assertThemeFiles(name, files), PathError);
});

test('assertAllowed accepts theme files', () => {
  assertAllowed('cv/themes/mine/entries/NormalEntry.j2.typ');
  assert.throws(() => assertAllowed('cv/themes/mine/x.py'), PathError);
  assert.throws(() => assertAllowed('cv/themes/mine/../x.typ'), PathError);
});

test('affectsCvPdf includes styles', () => {
  assert.ok(affectsCvPdf(['config/cv-styles.yml']));
  assert.ok(affectsCvPdf(['cv/themes/mine/Header.j2.typ']));
});
