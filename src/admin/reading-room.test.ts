/* eslint-disable vue/one-component-per-file -- each test mounts its own root component */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citeLabel,
  pidLabel,
  markdownBlocks,
  passageSegments,
  progressLine,
  selectionInPassage,
  textLabel,
} from './reading-room';
import type { Cite, Output, TextState } from '../lib/reading/types';

test('markdownBlocks reads paragraphs, lists, emphasis, code and cites', () => {
  const md = [
    '## Findings',
    '',
    'First **bold**, *em* and _em2_ with `x*y` [12:S2.p3].',
    'Same paragraph; snake_case_name stays.',
    '',
    '- one',
    '* two [12:S1.p1, 13:page2]',
    '',
    '1. first',
    '2. second',
    'continued',
  ].join('\n');
  assert.deepEqual(markdownBlocks(md), [
    { t: 'h', inl: [{ t: 'text', s: 'Findings' }] },
    {
      t: 'p',
      inl: [
        { t: 'text', s: 'First ' },
        { t: 'strong', s: 'bold' },
        { t: 'text', s: ', ' },
        { t: 'em', s: 'em' },
        { t: 'text', s: ' and ' },
        { t: 'em', s: 'em2' },
        { t: 'text', s: ' with ' },
        { t: 'code', s: 'x*y' },
        { t: 'text', s: ' ' },
        { t: 'cite', cites: [{ paper: 12, pid: 'S2.p3' }] },
        { t: 'text', s: '. Same paragraph; snake_case_name stays.' },
      ],
    },
    {
      t: 'ul',
      items: [
        [{ t: 'text', s: 'one' }],
        [
          { t: 'text', s: 'two ' },
          {
            t: 'cite',
            cites: [
              { paper: 12, pid: 'S1.p1' },
              { paper: 13, pid: 'page2' },
            ],
          },
        ],
      ],
    },
    { t: 'ol', items: [[{ t: 'text', s: 'first' }], [{ t: 'text', s: 'second continued' }]] },
  ]);
});

test('markdownBlocks keeps a loose list one list, and a cite inside bold a cite', () => {
  const T = (s: string) => [{ t: 'text', s }];
  assert.deepEqual(markdownBlocks('1. a\n\n2. b\n\n3. c\n\nAfter.'), [
    { t: 'ol', items: [T('a'), T('b'), T('c')] },
    { t: 'p', inl: T('After.') },
  ]);
  assert.deepEqual(markdownBlocks('- a\n\n- b\n\n1. c'), [
    { t: 'ul', items: [T('a'), T('b')] },
    { t: 'ol', items: [T('c')] },
  ]);
  assert.deepEqual(markdownBlocks('**Key [12:S2.p3] point** and *so [12:S1.p1]*'), [
    {
      t: 'p',
      inl: [
        { t: 'strong', s: 'Key ' },
        { t: 'cite', cites: [{ paper: 12, pid: 'S2.p3' }] },
        { t: 'strong', s: ' point' },
        { t: 'text', s: ' and ' },
        { t: 'em', s: 'so ' },
        { t: 'cite', cites: [{ paper: 12, pid: 'S1.p1' }] },
      ],
    },
  ]);
});

test('markdownBlocks leaves links and HTML as text', () => {
  const md = 'See [link](javascript:x) and <img src=x onerror=alert(1)> and ![i](y.png) and 2 * 3 * 4';
  assert.deepEqual(markdownBlocks(md), [{ t: 'p', inl: [{ t: 'text', s: md }] }]);
});

async function dom() {
  const { Window } = await import('happy-dom');
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, SVGElement: win.SVGElement, Element: win.Element });
  return win;
}

test('AnswerText renders HTML in an answer as text', async () => {
  const win = await dom();
  const { createApp, h } = await import('vue');
  const { AnswerText } = await import('./RoomText');
  const body = 'Look: <img src=x onerror=alert(1)> and [link](javascript:x) **bold** [12:S2.p3]';
  const el = win.document.createElement('div') as unknown as Element;
  createApp({ render: () => h(AnswerText, { body, known: new Set(['12:S2.p3']), scans: new Set<number>() }) }).mount(
    el,
  );
  assert.equal(el.querySelector('img'), null);
  assert.equal(el.querySelector('a'), null);
  assert.ok(el.textContent?.includes('<img src=x onerror=alert(1)>'));
  assert.ok(el.textContent?.includes('[link](javascript:x)'));
  assert.equal(el.querySelector('strong')?.textContent, 'bold');
});

test('a cite button emits its Cite; unknown ones are disabled, scan pages plain text', async () => {
  const win = await dom();
  const { createApp, h } = await import('vue');
  const { AnswerText, ClaimList } = await import('./RoomText');
  const got: Cite[] = [];
  const el = win.document.createElement('div') as unknown as Element;
  createApp({
    render: () =>
      h(AnswerText, {
        body: 'A [12:S2.p3, 12:S9.p9] B [13:page4]',
        known: new Set(['12:S2.p3']),
        scans: new Set([13]),
        onCite: (c: Cite) => got.push(c),
      }),
  }).mount(el);
  const buttons = [...el.querySelectorAll('button')] as unknown as HTMLButtonElement[];
  assert.deepEqual(
    buttons.map((b) => [b.textContent, b.disabled]),
    [
      ['§2 ¶3', false],
      ['§9 ¶9', true],
    ],
  );
  assert.equal(buttons[0].title, 'S2.p3');
  assert.equal(buttons[1].title, 'This passage is no longer in the text');
  buttons[0].click();
  assert.deepEqual(got, [{ paper: 12, pid: 'S2.p3' }]);
  assert.ok(el.textContent?.includes('p. 4'));

  const list = win.document.createElement('div') as unknown as Element;
  createApp({
    render: () =>
      h(ClaimList, {
        sections: [
          {
            heading: 'Main result',
            claims: [
              { text: 'It works.', cites: [{ paper: 12, pid: 'S2.p3' }] },
              { text: 'Transformers exist.', cites: [], mine: 'My paper' },
            ],
          },
        ],
        papers: new Map([[12, { authors: ['Ashish Vaswani', 'Noam Shazeer'] }]]),
        known: new Set(['12:S2.p3']),
        scans: new Set<number>(),
        onCite: (c: Cite) => got.push(c),
      }),
  }).mount(list);
  const text = list.textContent ?? '';
  for (const s of ['Main result', 'It works.', 'Transformers exist.', 'Background', 'Your work: My paper'])
    assert.ok(text.includes(s), s);
  (list.querySelector('button') as unknown as HTMLButtonElement).click();
  assert.equal(list.querySelector('button')?.textContent, 'Vaswani §2 ¶3');
  assert.equal(got.length, 2);
});

test('PaperText renders passages, highlights and figure links as text', async () => {
  const win = await dom();
  const { createApp, h } = await import('vue');
  const { PaperText } = await import('./RoomText');
  const el = win.document.createElement('div') as unknown as Element;
  createApp({
    render: () =>
      h(PaperText, {
        paperId: 7,
        passages: [
          { pid: 'S1', kind: 'h2', body: 'Intro' },
          { pid: 'S1.p1', kind: 'p', body: 'abc <b>def</b>' },
          { pid: 'S1.F1', kind: 'figure', body: 'A cat' },
        ],
        highlights: [{ id: 3, paperId: 7, pid: 'S1.p1', start: 0, end: 3, quote: 'abc', comment: '' }],
        arxiv: '2401.01234',
        flash: 'S1.p1',
      }),
  }).mount(el);
  assert.equal(el.querySelector('b'), null);
  assert.equal(el.querySelector('h3')?.textContent, 'Intro');
  const p = el.querySelector('#psg-7-S1\\.p1') as unknown as HTMLElement;
  assert.equal(p.dataset.pid, 'S1.p1');
  assert.ok(p.classList.contains('is-flash'));
  assert.equal(p.textContent, 'abc <b>def</b>');
  assert.equal(p.querySelector('mark')?.textContent, 'abc');
  assert.equal(p.querySelector('mark')?.getAttribute('data-hl'), '3');
  const a = el.querySelector('a') as unknown as HTMLAnchorElement;
  assert.equal(a.getAttribute('href'), 'https://arxiv.org/html/2401.01234#S1.F1');
  assert.equal(a.textContent, 'Figure on arXiv');
});

test('passageSegments splits at overlapping highlights', () => {
  assert.deepEqual(
    passageSegments('abcdefghij', [
      { id: 1, start: 2, end: 6 },
      { id: 2, start: 4, end: 8 },
    ]),
    [
      { s: 'ab', ids: [] },
      { s: 'cd', ids: [1] },
      { s: 'ef', ids: [1, 2] },
      { s: 'gh', ids: [2] },
      { s: 'ij', ids: [] },
    ],
  );
  assert.deepEqual(passageSegments('abc', []), [{ s: 'abc', ids: [] }]);
});

test('selectionInPassage refuses a selection across passages', async () => {
  const win = await dom();
  const doc = win.document;
  doc.body.innerHTML = '<p data-pid="S1.p1">ab<mark>cd</mark>ef</p><p data-pid="S1.p2">gh</p>';
  const [p1, p2] = [...doc.querySelectorAll('p')];
  const sel = win.getSelection()!;
  const range = doc.createRange();
  range.setStart(p1.childNodes[1].firstChild!, 1);
  range.setEnd(p1.childNodes[2], 1);
  sel.removeAllRanges();
  sel.addRange(range);
  assert.deepEqual(selectionInPassage(sel as unknown as Selection), { pid: 'S1.p1', start: 3, end: 5, quote: 'de' });
  const across = doc.createRange();
  across.setStart(p1.childNodes[0], 1);
  across.setEnd(p2.firstChild!, 1);
  sel.removeAllRanges();
  sel.addRange(across);
  assert.equal(selectionInPassage(sel as unknown as Selection), null);
  sel.collapse(p1.firstChild!, 1);
  assert.equal(selectionInPassage(sel as unknown as Selection), null);
});

test('citeLabel names the paper in a notebook', () => {
  assert.equal(citeLabel({ paper: 1, pid: 'S2.p3' }), '§2 ¶3');
  assert.equal(citeLabel({ paper: 1, pid: 'page3' }), 'p. 3');
  const papers = new Map([
    [1, { authors: ['Ashish Vaswani', 'Noam Shazeer'] }],
    [2, { authors: [] }],
  ]);
  assert.equal(citeLabel({ paper: 1, pid: 'S2.p3' }, papers), 'Vaswani §2 ¶3');
  assert.equal(citeLabel({ paper: 1, pid: 'page3' }, papers), 'Vaswani p. 3');
  assert.equal(citeLabel({ paper: 2, pid: 'S1.p1' }, papers), '§1 ¶1');
});

test('pidLabel names a passage as a reader would', () => {
  const cases: [string, string][] = [
    ['S3.SS5.p5', '§3.5 ¶5'],
    ['S1.p4', '§1 ¶4'],
    ['S1', '§1'],
    ['S3.SS2.SSS1.p2', '§3.2.1 ¶2'],
    ['S7.SS0.SSS0.Px1.p1', '§7 ¶1'],
    ['A1.SS2.p3', '§A.2 ¶3'],
    ['Sx1.p2', '¶2'],
    ['p1', '¶1'],
    ['abs.1', 'Abstract'],
    ['abs.2', 'Abstract ¶2'],
    ['S2.F1', 'Figure 1'],
    ['Sx1.F3', 'Figure 3'],
    ['S6.T2', 'Table 2'],
    ['page4', 'p. 4'],
    ['p4.2', 'p. 4 ¶2'],
    ['S3.F1.sf2', 'S3.F1.sf2'],
    ['weird', 'weird'],
  ];
  assert.deepEqual(
    cases.map(([pid]) => [pid, pidLabel(pid)]),
    cases,
  );
});

test('textLabel', () => {
  const t = (over: Partial<TextState>): TextState => ({ source: null, error: null, note: null, pages: null, ...over });
  assert.equal(textLabel(t({ source: 'arxiv-html' })), null);
  assert.equal(
    textLabel(t({ source: 'arxiv-pdf' })),
    'Text extracted from arXiv’s PDF: equations and tables may read oddly.',
  );
  assert.equal(textLabel(t({ source: 'upload' })), 'Text extracted from your PDF.');
  assert.equal(
    textLabel(t({ source: 'scan' })),
    'This PDF is a scan with no text layer, so there is no text to show. The AI reads the page images; citations name a page only.',
  );
  assert.equal(
    textLabel(t({ source: 'abstract', note: 'arXiv has no full text' })),
    'Only the abstract is available (arXiv has no full text). The summary and chat are grounded on it alone.',
  );
  assert.equal(
    textLabel(t({ source: 'abstract' })),
    'Only the abstract is available. The summary and chat are grounded on it alone.',
  );
  assert.equal(
    textLabel(t({ source: 'arxiv-html', error: 'HTTP 503‮' })),
    'The full text couldn’t be fetched: HTTP 503. It is tried again the next time this runs.',
  );
  assert.equal(textLabel(t({})), 'Text not fetched yet');
});

test('progressLine', () => {
  const o = (over: Partial<Output>): Output => ({
    kind: 'summary',
    status: 'running',
    body: null,
    error: null,
    updatedAt: '',
    ...over,
  });
  const wait = 'arXiv asks for 15 seconds between fetches, so this can take a minute.';
  assert.equal(progressLine(o({}), false, false), `Fetching the paper’s text from arXiv. ${wait}`);
  assert.equal(progressLine(o({}), false, true), `Fetching the papers’ text from arXiv. ${wait}`);
  assert.equal(progressLine(o({}), true, false), 'Writing the summary. This takes up to a minute.');
  assert.equal(progressLine(o({ kind: 'briefing' }), true, true), 'Writing the briefing. This takes up to a minute.');
  assert.equal(progressLine(o({ kind: 'faq' }), true, false), 'Writing the FAQ. This takes up to a minute.');
  assert.equal(progressLine(o({ kind: 'glossary' }), true, false), 'Writing the glossary. This takes up to a minute.');
  assert.equal(progressLine(o({ status: 'ready' }), true, false), null);
  assert.equal(progressLine(undefined, false, false), null);
});
