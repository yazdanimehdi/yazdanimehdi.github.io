import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { minimalPdf } from './test-pdf';
import { isScan, pdfLines, splitArxivHtml, splitPdfPages } from './text';

const fixture = fs.readFileSync('tests/fixtures/reading/arxiv-html.html', 'utf8');
const passages = splitArxivHtml(fixture);
const body = (pid: string) => passages.find((p) => p.pid === pid)?.body ?? '';

test('splitArxivHtml keeps LaTeXML ids and reading order', () => {
  assert.deepEqual(
    passages.map((p) => [p.pid, p.kind]),
    [
      ['abs.1', 'p'],
      ['S1', 'h2'],
      ['S1.p1', 'p'],
      ['S1.p3', 'p'],
      ['S2', 'h2'],
      ['S2.F1', 'figure'],
      ['S2.p1', 'p'],
      ['S2.p2', 'p'],
      ['S5', 'h2'],
      ['S5.p1', 'p'],
      ['S5.SS1', 'h3'],
      ['S5.SS1.p1', 'p'],
    ],
  );
  assert.match(body('abs.1'), /^We introduce Mistral 7B, a 7–billion-parameter language model/);
  assert.equal(body('S1'), '1 Introduction');
  assert.ok(!/\s{2}|^\s|\s$/.test(passages.map((p) => p.body).join('\n')), 'whitespace collapsed');
});

test('a figure becomes its own passage after its paragraph', () => {
  assert.match(body('S2.F1'), /^Figure 1: Sliding Window Attention\. The number of operations/);
  const inPara = splitArxivHtml(
    '<section id="S1"><div id="S1.p1" class="ltx_para"><p class="ltx_p">Before.</p>' +
      '<figure id="S1.F1" class="ltx_figure"><figcaption>Figure 1: A cat.</figcaption></figure>' +
      '<p class="ltx_p">After.</p></div><div id="S1.p2" class="ltx_para">Next.</div></section>',
  );
  assert.deepEqual(inPara, [
    { pid: 'S1.p1', kind: 'p', body: 'Before. After.' },
    { pid: 'S1.F1', kind: 'figure', body: 'Figure 1: A cat.' },
    { pid: 'S1.p2', kind: 'p', body: 'Next.' },
  ]);
});

test('math reads as its TeX', () => {
  assert.match(body('S2.F1'), /\$W=3\$/);
  assert.match(body('S2.p2'), /beyond the window size \$W\$/);
});

test('footnotes and the bibliography are dropped', () => {
  assert.match(body('S1.p3'), /reference implementation facilitating easy deployment/);
  assert.ok(!body('S1.p3').includes('github.com'));
  assert.ok(!passages.some((p) => p.pid.startsWith('bib') || p.body.includes('References')));
  assert.ok(!passages.some((p) => /localStorage|ds-announcement/.test(p.body)), 'script and style dropped');
});

test("HTML with no ltx_para gives no 'p' passage", () => {
  assert.deepEqual(splitArxivHtml('<html><body>Full text</body></html>'), []);
});

test('pdfLines reads lines per page', async () => {
  const pdf = minimalPdf([
    [
      [700, 'First line'],
      [686, 'second line'],
    ],
    [[700, 'Page two']],
  ]);
  assert.deepEqual(await pdfLines(pdf), [
    [
      { text: 'First line', y: 700 },
      { text: 'second line', y: 686 },
    ],
    [{ text: 'Page two', y: 700 }],
  ]);
});

test('splitPdfPages splits paragraphs on a wide gap and numbers them per page', async () => {
  const pdf = minimalPdf([
    [
      [700, 'One'],
      [686, 'two'],
      [672, 'three'],
      [658, 'four.'],
      [612, 'A new paragraph.'],
      [50, '1'],
    ],
    [[700, 'Page two.']],
  ]);
  assert.deepEqual(splitPdfPages(await pdfLines(pdf)), [
    { pid: 'p1.1', kind: 'p', body: 'One two three four.' },
    { pid: 'p1.2', kind: 'p', body: 'A new paragraph.' },
    { pid: 'p2.1', kind: 'p', body: 'Page two.' },
  ]);
});

test('a line higher than the last starts a paragraph (next column)', () => {
  assert.deepEqual(
    splitPdfPages([
      [
        { text: 'Left column', y: 100 },
        { text: 'Right column', y: 700 },
      ],
    ]).map((p) => p.pid),
    ['p1.1', 'p1.2'],
  );
});

test('a hyphen at a line end joins the word', () => {
  assert.deepEqual(
    splitPdfPages([
      [
        { text: 'the trans-', y: 700 },
        { text: 'former is Mistral-', y: 686 },
        { text: '7B', y: 672 },
      ],
    ]),
    [{ pid: 'p1.1', kind: 'p', body: 'the transformer is Mistral- 7B' }],
  );
});

test('isScan is true for a PDF with no text', async () => {
  const lines = await pdfLines(minimalPdf([[], []]));
  assert.equal(isScan(splitPdfPages(lines), lines.length), true);
  assert.equal(isScan(passages, 1), false);
});

test('pdfLines throws on bytes that are not a PDF', async () => {
  await assert.rejects(pdfLines(new TextEncoder().encode('<html>not a pdf</html>')));
});
