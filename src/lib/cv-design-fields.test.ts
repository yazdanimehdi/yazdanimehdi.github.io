import test from 'node:test';
import assert from 'node:assert/strict';
import schema from '../../services/cv-render/design-schema.json';
import { designFields, hexToRgb, rgbToHex, setDesign, type DesignField } from './cv-design-fields';

const GROUP_KEYS = {
  Page: ['page'],
  Text: ['typography', 'links'],
  Colors: ['colors'],
  Spacing: ['header', 'section_titles', 'sections', 'entries'],
};
const field = (theme: string, density: 'compact' | 'normal' | 'airy', path: string): DesignField =>
  designFields(schema, theme, density)
    .flatMap((g) => g.fields)
    .find((f) => f.path.join('.') === path)!;

test('groups', () => {
  const groups = designFields(schema, 'classic', 'normal');
  assert.deepStrictEqual(
    groups.map((g) => g.group),
    ['Page', 'Text', 'Colors', 'Spacing'],
  );
  for (const g of groups) {
    assert.ok(g.fields.length, g.group);
    for (const f of g.fields) assert.ok(GROUP_KEYS[g.group].includes(f.path[0]), `${g.group}: ${f.path.join('.')}`);
  }
  assert.ok(!groups.some((g) => g.fields.some((f) => f.path.includes('templates'))));
});

test('placeholder layers', () => {
  assert.equal(field('harvard', 'normal', 'page.top_margin').placeholder, '0.5in');
  assert.equal(field('harvard', 'compact', 'page.top_margin').placeholder, '1.2cm');
  assert.equal(field('classic', 'normal', 'page.top_margin').placeholder, '0.7in');
  assert.equal(field('harvard', 'normal', 'typography.font_family.body').placeholder, 'XCharter');
  assert.equal(field('classic', 'normal', 'sections.show_time_spans_in').placeholder, 'experience');
});

test('kinds', () => {
  const size = field('classic', 'normal', 'page.size');
  assert.equal(size.kind, 'select');
  assert.deepStrictEqual(size.options, ['a4', 'a5', 'us-letter', 'us-executive']);
  assert.equal(field('classic', 'normal', 'colors.name').kind, 'color');
  assert.equal(field('classic', 'normal', 'page.show_footer').kind, 'boolean');
  assert.equal(field('classic', 'normal', 'page.top_margin').kind, 'dimension');
  assert.equal(field('classic', 'normal', 'sections.show_time_spans_in').kind, 'list');
  assert.equal(field('classic', 'normal', 'typography.font_family.body').kind, 'text');
});

test('setDesign: an empty value inherits, and empty parents go with it', () => {
  const design: Record<string, unknown> = { page: { size: 'a4' } };
  setDesign(design, ['typography', 'font_size', 'body'], '9pt');
  assert.deepStrictEqual(design, { page: { size: 'a4' }, typography: { font_size: { body: '9pt' } } });
  setDesign(design, ['typography', 'font_size', 'body'], '');
  setDesign(design, ['page', 'top_margin'], undefined);
  assert.deepStrictEqual(design, { page: { size: 'a4' } });
  setDesign(design, ['page', 'size'], '');
  assert.deepStrictEqual(design, {});
});

test('rgb round-trip', () => {
  assert.equal(hexToRgb(rgbToHex('rgb(0, 79, 144)')!), 'rgb(0, 79, 144)');
  assert.equal(rgbToHex('rgb(0,0,0)'), '#000000');
  assert.equal(rgbToHex('Black'), null);
});
