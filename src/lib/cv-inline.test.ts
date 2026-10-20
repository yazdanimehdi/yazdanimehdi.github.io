import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, plainText, toggleFormat, type InlineFormat } from './cv-inline';

test('parseInline: plain text is one span', () => {
  assert.deepEqual(parseInline('Professor of CS'), [{ text: 'Professor of CS' }]);
  assert.deepEqual(parseInline(''), []);
});

test('parseInline: bold, italic and both', () => {
  assert.deepEqual(parseInline('a **b** c'), [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]);
  assert.deepEqual(parseInline('*i*'), [{ text: 'i', italic: true }]);
  assert.deepEqual(parseInline('***both***'), [{ text: 'both', bold: true, italic: true }]);
});

test('parseInline: nested emphasis', () => {
  assert.deepEqual(parseInline('**bold *and italic***'), [
    { text: 'bold ', bold: true },
    { text: 'and italic', bold: true, italic: true },
  ]);
  assert.deepEqual(parseInline('**bold *italic* bold**'), [
    { text: 'bold ', bold: true },
    { text: 'italic', bold: true, italic: true },
    { text: ' bold', bold: true },
  ]);
});

test('parseInline: escaped asterisks are literal', () => {
  assert.deepEqual(parseInline('**Mehdi Yazdani-Jahromi**\\*'), [
    { text: 'Mehdi Yazdani-Jahromi', bold: true },
    { text: '*' },
  ]);
  assert.deepEqual(parseInline('\\*not italic\\*'), [{ text: '*not italic*' }]);
});

test('parseInline: unclosed and space-flanked markers stay literal', () => {
  assert.deepEqual(parseInline('**'), [{ text: '**' }]);
  assert.deepEqual(parseInline('**bold'), [{ text: '**bold' }]);
  assert.deepEqual(parseInline('5 * 3 = 15'), [{ text: '5 * 3 = 15' }]);
  assert.deepEqual(parseInline('a ** b ** c'), [{ text: 'a ** b ** c' }]);
});

test('parseInline: an empty bold renders nothing', () => {
  assert.deepEqual(parseInline('****'), []);
  assert.deepEqual(parseInline('a****b'), [{ text: 'ab' }]);
});

test('parseInline: font spans, with emphasis inside', () => {
  assert.deepEqual(parseInline('[code]{.mono}'), [{ text: 'code', font: 'mono' }]);
  assert.deepEqual(parseInline('use [**Rust** now]{.serif}!'), [
    { text: 'use ' },
    { text: 'Rust', bold: true, font: 'serif' },
    { text: ' now', font: 'serif' },
    { text: '!' },
  ]);
  assert.deepEqual(parseInline('[x]{.comic}'), [{ text: '[x]{.comic}' }], 'unknown font: literal');
  assert.deepEqual(parseInline('[x] y'), [{ text: '[x] y' }]);
});

test('parseInline: links to http(s) and mailto only', () => {
  assert.deepEqual(parseInline('Published on [GitHub](https://github.com/x/y)'), [
    { text: 'Published on ' },
    { text: 'GitHub', href: 'https://github.com/x/y' },
  ]);
  assert.deepEqual(parseInline('[Email](mailto:a@b.edu)'), [{ text: 'Email', href: 'mailto:a@b.edu' }]);
  assert.deepEqual(parseInline('[**Bold** link](http://a.b)'), [
    { text: 'Bold', bold: true, href: 'http://a.b' },
    { text: ' link', href: 'http://a.b' },
  ]);
  assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ text: '[x](javascript:alert(1))' }]);
  assert.deepEqual(parseInline('[x](/relative)'), [{ text: '[x](/relative)' }]);
});

test('parseInline: emphasis does not cross a span boundary', () => {
  assert.deepEqual(parseInline('*a [b*]{.mono}'), [{ text: '*a ' }, { text: 'b*', font: 'mono' }]);
});

test('parseInline: adjacent spans with the same style merge', () => {
  assert.deepEqual(parseInline('**a****b**'), [{ text: 'ab', bold: true }]);
  assert.deepEqual(parseInline('a\\*b'), [{ text: 'a*b' }]);
});

test('plainText drops the markup and keeps escaped asterisks', () => {
  assert.equal(plainText('**Jane** *Doe*\\* [x]{.mono} [site](https://a.b)'), 'Jane Doe* x site');
});

/** `‹` and `›` mark the selection in and out. */
function toggle(marked: string, format: InlineFormat): string {
  const start = marked.indexOf('‹');
  const end = marked.indexOf('›') - 1;
  const r = toggleFormat(marked.replace('‹', '').replace('›', ''), start, end, format);
  return r.value.slice(0, r.start) + '‹' + r.value.slice(r.start, r.end) + '›' + r.value.slice(r.end);
}

test('toggleFormat: bold and italic wrap the selection, keeping it on the text', () => {
  assert.equal(toggle('a ‹word› b', 'bold'), 'a **‹word›** b');
  assert.equal(toggle('a ‹word› b', 'italic'), 'a *‹word›* b');
  assert.equal(toggle('a ‹word ›b', 'bold'), 'a **‹word›** b', 'edge whitespace stays outside');
});

test('toggleFormat: toggling again unwraps', () => {
  assert.equal(toggle('a **‹word›** b', 'bold'), 'a ‹word› b');
  assert.equal(toggle('a *‹word›* b', 'italic'), 'a ‹word› b');
  assert.equal(toggle('a ‹**word**› b', 'bold'), 'a ‹word› b', 'markers inside the selection');
  assert.equal(toggle('***‹x›***', 'bold'), '*‹x›*');
  assert.equal(toggle('***‹x›***', 'italic'), '**‹x›**');
});

test('toggleFormat: italic inside bold adds, does not strip the bold', () => {
  assert.equal(toggle('**‹x›**', 'italic'), '***‹x›***');
  assert.equal(toggle('*‹x›*', 'bold'), '***‹x›***');
});

test('toggleFormat: an escaped asterisk is not a marker', () => {
  assert.equal(toggle('\\*‹x›*', 'italic'), '\\**‹x›**');
});

test('toggleFormat: empty selection inserts markers around the caret, and removes empty ones', () => {
  assert.equal(toggle('a ‹›b', 'bold'), 'a **‹›**b');
  assert.equal(toggle('a **‹›**b', 'bold'), 'a ‹›b');
});

test('toggleFormat: fonts wrap, switch and unwrap', () => {
  assert.equal(toggle('use ‹code›', { font: 'mono' }), 'use [‹code›]{.mono}');
  assert.equal(toggle('use [‹code›]{.mono}', { font: 'mono' }), 'use ‹code›');
  assert.equal(toggle('use [‹code›]{.mono}', { font: 'serif' }), 'use [‹code›]{.serif}');
  assert.equal(toggle('use ‹[code]{.mono}›', { font: null }), 'use ‹code›');
  assert.equal(toggle('use ‹code›', { font: null }), 'use ‹code›');
});

test('toggleFormat: link wraps with the URL selected, and unwraps an exact link', () => {
  assert.equal(toggle('see ‹GitHub›', 'link'), 'see [GitHub](‹https://›)');
  assert.equal(toggle('see [‹GitHub›](https://g.com)', 'link'), 'see ‹GitHub›');
  assert.equal(toggle('see ‹[GitHub](https://g.com)›', 'link'), 'see ‹GitHub›');
});

test('toggleFormat: every wrap parses back to the formatted text', () => {
  const cases: [InlineFormat, object][] = [
    ['bold', { bold: true }],
    ['italic', { italic: true }],
    [{ font: 'sans' }, { font: 'sans' }],
  ];
  for (const [format, style] of cases) {
    const { value } = toggleFormat('a word b', 2, 6, format);
    assert.deepEqual(parseInline(value), [{ text: 'a ' }, { text: 'word', ...style }, { text: ' b' }]);
  }
});
