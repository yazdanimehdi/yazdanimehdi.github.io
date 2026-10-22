import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageLine, coverageState, evidenceLabel, httpUrl, runLine, runNotes, visible } from './career';

test('visible strips format characters and turns line separators into spaces', () => {
  assert.equal(visible('a\u202eb\u200bc\u2028d\u2029e\ufefff'), 'abc d ef');
  assert.equal(visible('plain text'), 'plain text');
});

test('evidenceLabel shows a 0-based ref as a 1-based entry and leaves anything else alone', () => {
  assert.equal(evidenceLabel('researchExperience 1'), 'researchExperience entry 2');
  assert.equal(evidenceLabel('skills 0'), 'skills entry 1');
  assert.equal(evidenceLabel('the Acme job'), 'the Acme job');
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

test('runLine counts the night, its non-zero outcomes included, or says it was paused', () => {
  const run = {
    at: '2026-10-22T03:00:00Z',
    sources: [
      { id: 'a', found: 5, added: 2 },
      { id: 'b', found: 1, added: 0 },
    ],
    scored: 4,
    failed: 0,
    deferred: 0,
  };
  assert.equal(runLine(run), '6 found · 4 scored');
  assert.equal(runLine({ ...run, drafted: 0, prefilled: 0, handedOff: 0, limited: 0 }), '6 found · 4 scored');
  assert.equal(
    runLine({ ...run, deferred: 2, failed: 1, drafted: 3, prefilled: 2, handedOff: 1, limited: 4 }),
    '6 found · 4 scored · 2 left for later · 1 failed to score · 3 drafted · 2 pre-filled · 1 to finish yourself · ' +
      '4 held back by limits',
  );
  assert.equal(runLine({ ...run, paused: true }), 'Paused: nothing ran');
});

test('runNotes lists why the night stopped and a digest that failed, never a sent or skipped one', () => {
  const run = { at: '2026-10-22T03:00:00Z', sources: [], scored: 0, failed: 0, deferred: 0 };
  assert.deepEqual(runNotes({ ...run, digest: 'sent' }), []);
  assert.deepEqual(runNotes({ ...run, digest: 'skipped' }), []);
  assert.deepEqual(runNotes({ ...run, stopped: 'out of quota\u202e', digest: 'Resend: domain not verified' }), [
    'Stopped early: out of quota',
    'The digest email wasn’t sent: Resend: domain not verified',
  ]);
});
