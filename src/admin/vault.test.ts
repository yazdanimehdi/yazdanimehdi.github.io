import test from 'node:test';
import assert from 'node:assert/strict';
import { completeAt, completeLink, layout, linkQuery, matchTitles, nearestNode, outLinks } from './vault';
import type { NoteRow } from '../lib/reading/types';

const note = (id: number, title: string): NoteRow => ({ id, kind: 'free', title, updatedAt: '2026-10-22T00:00:00Z' });

test('linkQuery finds an open [[ before the caret', () => {
  assert.deepEqual(linkQuery('see [[Att', 9), { start: 6, query: 'Att' });
  assert.equal(linkQuery('see [[Att]] x', 13), null);
  assert.equal(linkQuery('[[a\nb', 5), null);
  assert.equal(linkQuery('[[a|b', 5), null);
  assert.equal(linkQuery('[[a#b', 5), null);
  assert.equal(linkQuery('no link', 7), null);
});

test('completeLink closes the link once', () => {
  assert.deepEqual(completeLink('see [[Att', 9, 6, 'Attention'), { text: 'see [[Attention]]', caret: 17 });
  assert.deepEqual(completeLink('see [[Att]] x', 9, 6, 'Attention'), { text: 'see [[Attention]] x', caret: 17 });
});

test('completeAt reads the link at the caret now, so a moved caret never loses text', () => {
  const notes = [note(1, 'Attention'), note(2, 'Attention heads')];
  const text = 'see [[ and my important thought';
  // [[ typed mid-line: the list opens at caret 6; then End or Home moves the caret before Enter.
  assert.equal(completeAt(text, text.length, notes, 9, 0), null, 'End: nothing matches, Enter is a new line');
  assert.equal(completeAt(text, 0, notes, 9, 0), null, 'Home: no link open, Enter is a new line');
  assert.deepEqual(completeAt(text, 6, notes, 9, 1), {
    text: 'see [[Attention heads]] and my important thought',
    caret: 23,
  });
  assert.equal(completeAt('see [[Att', 9, notes, 1, 5), null, 'no such option');
});

test('matchTitles puts prefix matches first and leaves out the note itself', () => {
  const notes = [
    note(1, 'Self attention'),
    note(2, 'attention heads'),
    note(3, 'Attention'),
    note(4, 'Cats'),
    note(5, 'Cross-attention'),
  ];
  assert.deepEqual(
    matchTitles(notes, 'ATT', 4).map((n) => n.title),
    ['Attention', 'attention heads', 'Cross-attention', 'Self attention'],
  );
  assert.deepEqual(
    matchTitles(notes, 'att', 3).map((n) => n.title),
    ['attention heads', 'Cross-attention', 'Self attention'],
  );
  assert.deepEqual(
    matchTitles(notes, 'att', 5, 2).map((n) => n.id),
    [3, 2],
  );
});

test('outLinks resolves titles ignoring case', () => {
  const notes = [note(1, 'Attention'), note(2, 'Transformers')];
  assert.deepEqual(outLinks('[[attention]] and [[Missing|m]] and [[TRANSFORMERS#Method]] and [[Attention]]', notes), [
    { title: 'attention', id: 1 },
    { title: 'Missing', id: null },
    { title: 'TRANSFORMERS', id: 2 },
    { title: 'Attention', id: 1 },
  ]);
});

const inside = (pts: { x: number; y: number }[], w: number, h: number) =>
  pts.every((p) => p.x >= 24 && p.x <= w - 24 && p.y >= 24 && p.y <= h - 24);

test('layout is deterministic and stays in bounds', () => {
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
  ];
  const a = layout(12, edges, 390, 300);
  assert.equal(a.length, 12);
  assert.deepEqual(a, layout(12, edges, 390, 300));
  assert.ok(inside(a, 390, 300));
  assert.deepEqual(layout(0, [], 390, 300), []);
  assert.ok(inside(layout(1, [], 390, 300), 390, 300));
});

test('linked nodes end closer than unlinked ones', () => {
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 0],
    [3, 4],
    [4, 5],
    [5, 3],
  ];
  const p = layout(6, edges, 600, 400);
  const d = (i: number, j: number) => Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y);
  const edge = edges.reduce((s, [i, j]) => s + d(i, j), 0) / edges.length;
  let across = 0;
  for (const i of [0, 1, 2]) for (const j of [3, 4, 5]) across += d(i, j);
  assert.ok(edge < across / 9, `${edge} < ${across / 9}`);
});

test('layout spreads a graph over the box instead of piling it on the edges', () => {
  for (const [n, h] of [
    [37, 625],
    [200, 1000],
  ]) {
    const edges: [number, number][] = [];
    // chains of five, apart from one another, as a vault's topics are
    for (let i = 0; i < n; i++) if (i % 5 !== 4 && i + 1 < n) edges.push([i, i + 1]);
    const p = layout(n, edges, 1000, h);
    const onEdge = p.filter((q) => q.x <= 25 || q.x >= 975 || q.y <= 25 || q.y >= h - 25);
    assert.ok(onEdge.length <= 4, `${onEdge.length} of ${n} on the edge`);
    // no two nodes on top of each other, as they end when piled on a wall
    let closest = Infinity;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) closest = Math.min(closest, Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y));
    assert.ok(closest > 1000 / Math.sqrt(n) / 4, `closest pair ${closest} apart`);
  }
});

test('nearestNode picks within reach only', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  assert.equal(nearestNode(pts, 8, 1, 5), 1);
  assert.equal(nearestNode(pts, 1, 1, 5), 0);
  assert.equal(nearestNode(pts, 5, 30, 5), null);
  assert.equal(nearestNode([], 0, 0, 5), null);
});
