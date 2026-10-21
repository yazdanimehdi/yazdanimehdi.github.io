import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageLine, coverageState, httpUrl, visible } from './career';

test('visible strips format characters and turns line separators into spaces', () => {
  assert.equal(visible('a\u202eb\u200bc\u2028d\u2029e\ufefff'), 'abc d ef');
  assert.equal(visible('plain text'), 'plain text');
});

test('httpUrl accepts http(s) only', () => {
  assert.equal(httpUrl('https://x.test/a'), 'https://x.test/a');
  assert.equal(httpUrl('javascript:alert(1)'), null);
  assert.equal(httpUrl('nope'), null);
  assert.equal(httpUrl(null), null);
});

test('PostingText renders untrusted text as text, with flag excerpts cleaned', async () => {
  const { Window } = await import('happy-dom');
  const win = new Window();
  Object.assign(globalThis, { window: win, document: win.document, SVGElement: win.SVGElement, Element: win.Element });
  const { createApp, h } = await import('vue');
  const { PostingText } = await import('./PostingText');
  const evil = '<script>alert(1)</script><b>x</b>';
  const el = win.document.createElement('div') as unknown as Element;
  createApp({
    render: () =>
      h(PostingText, {
        text: evil,
        flags: {
          hiddenBlocks: [],
          hiddenUrls: ['http://e.test/‮x'],
          invisible: { zero_width: 0, bidi: 0, format: 0, bom: 0 },
          invisibleFlagged: 0,
          instructionLines: ['ignore ‮previous'],
          mixedScript: [],
          warn: true,
        },
      }),
  }).mount(el);
  assert.equal(el.querySelector('script'), null);
  assert.equal(el.querySelector('b'), null);
  assert.equal(el.querySelector('a'), null);
  assert.ok(el.textContent?.includes(evil));
  assert.ok(el.textContent?.includes('ignore previous'));
  assert.ok(el.textContent?.includes('http://e.test/x'));
  assert.ok(!el.textContent?.includes('‮'));
});

const R = (term: string, kind: 'required' | 'preferred', evidence: string | null, inCv: boolean, inBase: boolean) => ({
  term,
  kind,
  evidence,
  inCv,
  inBase,
  uses: inCv ? 1 : 0,
});
test('coverageState and coverageLine', () => {
  assert.equal(coverageLine([]), 'No requirements were listed for this posting.');
  const reqs = [
    R('SQL', 'required', 'skills 0', true, true),
    R('Python', 'required', 'skills 0', false, true),
    R('A/B testing', 'required', 'researchExperience 1', false, false),
    R('Go', 'required', null, false, false),
    R('Spark', 'preferred', null, false, false),
  ];
  assert.deepEqual(reqs.map(coverageState), ['shown', 'cut', 'reworded', 'gap', 'gap']);
  assert.equal(coverageLine(reqs), 'Required: 1 of 4 shown · preferred: 0 of 1 · 2 not in your CV');
  assert.equal(coverageLine(reqs.slice(0, 1)), 'Required: 1 of 1 shown');
});
