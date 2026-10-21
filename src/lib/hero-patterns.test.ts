import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_PATTERN_NAMES, patternColor, patternMask, patternStyle } from './hero-patterns';

const theme = { ink: 'var(--ink)', accent: 'var(--accent)' };

test('every pattern is a well-formed SVG tile', () => {
  assert.ok(HERO_PATTERN_NAMES.length >= 15);
  for (const name of HERO_PATTERN_NAMES) {
    const svg = decodeURIComponent(patternMask(name).slice('url("data:image/svg+xml,'.length, -2));
    assert.match(
      svg,
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"><g [^>]+>.+<\/g><\/svg>$/,
    );
    assert.doesNotMatch(svg, /NaN|undefined/, name);
  }
});

test('patternMask: an unknown name draws the grid', () => {
  assert.equal(patternMask('nope'), patternMask('grid'));
  assert.equal(patternMask(undefined), patternMask('grid'));
});

test('patternColor: empty is ink, accent is the accent, unsafe values fall back to ink', () => {
  assert.equal(patternColor('', theme), 'var(--ink)');
  assert.equal(patternColor('Accent', theme), 'var(--accent)');
  assert.equal(patternColor('#7c3aed', theme), '#7c3aed');
  assert.equal(patternColor('rgb(10, 20, 30)', theme), 'rgb(10, 20, 30)');
  assert.equal(patternColor('teal', theme), 'teal');
  for (const bad of ['red; background: url(x)', 'url(https://x)', '#fff}', 'rgb(1,2,3);x:y', 'var(--x)']) {
    assert.equal(patternColor(bad, theme), 'var(--ink)', bad);
  }
});

test('patternStyle: a solid fill, a gradient with its angle, and the strength', () => {
  const solid = patternStyle({ name: 'dots' }, theme);
  assert.match(solid, /--hero-pattern-fill: var\(--ink\);/);
  assert.match(solid, /--hero-pattern-opacity: 0\.07;/);
  const gradient = patternStyle(
    { name: 'circuit', color: 'accent', color2: '#e11d48', angle: 90, strength: 'strong' },
    theme,
  );
  assert.match(gradient, /--hero-pattern-fill: linear-gradient\(90deg, var\(--accent\), #e11d48\);/);
  assert.match(gradient, /--hero-pattern-opacity: 0\.24;/);
  assert.match(patternStyle({ name: 'dots', color2: 'teal' }, theme), /linear-gradient\(135deg, var\(--ink\), teal\)/);
});

test('patternStyle: with brand colors, nothing chosen draws the brand gradient; a chosen color still wins', () => {
  const brand = { ...theme, secondary: 'var(--brand-2)' };
  assert.match(
    patternStyle({ name: 'dots', angle: 0 }, brand),
    /--hero-pattern-fill: linear-gradient\(0deg, var\(--accent\), var\(--brand-2\)\);/,
  );
  assert.match(patternStyle({ name: 'dots', color: 'secondary' }, brand), /--hero-pattern-fill: var\(--brand-2\);/);
  assert.match(patternStyle({ name: 'dots', color: 'secondary' }, theme), /--hero-pattern-fill: var\(--accent\);/);
  assert.match(patternStyle({ name: 'dots', color: '#123456' }, brand), /--hero-pattern-fill: #123456;/);
});
