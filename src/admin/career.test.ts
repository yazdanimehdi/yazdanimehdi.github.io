import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFeed, httpUrl, visible } from './career';
import type { PostingSummary } from '../lib/career/types';

const row = (id: number, score: number | null, gate: string | null = null): PostingSummary => ({
  id,
  company: 'Acme',
  title: `Job ${id}`,
  location: null,
  remote: null,
  score,
  gate,
  status: 'found',
  foundAt: '2026-10-21T00:00:00Z',
  flagged: false,
  draftState: 'none',
});

test('groupFeed splits by threshold and gate, keeps unscored', () => {
  const g = groupFeed(
    [row(1, 90), row(2, 70), row(3, 69), row(4, 95, 'language'), row(5, null), row(6, null, 'x')],
    70,
  );
  assert.deepEqual(
    g.matches.map((r) => r.id),
    [1, 2],
  );
  assert.deepEqual(
    g.below.map((r) => r.id),
    [3],
  );
  assert.deepEqual(
    g.gated.map((r) => r.id),
    [4, 6],
  );
  assert.deepEqual(
    g.unscored.map((r) => r.id),
    [5],
  );
});

test('visible strips format characters and line separators', () => {
  assert.equal(visible('a‮b​c d e﻿f'), 'abcdef');
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
