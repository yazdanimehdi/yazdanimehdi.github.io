import test from 'node:test';
import assert from 'node:assert/strict';
import { draftCandidates } from './nightly';
import { parsePrefs } from './settings';
import type { PostingSummary } from './types';

let n = 0;
const row = (company: string, score: number | null, extra: Partial<PostingSummary> = {}): PostingSummary => ({
  id: ++n,
  company,
  title: 'Engineer',
  location: null,
  remote: null,
  score,
  gate: null,
  status: 'found',
  foundAt: '2026-10-22T00:00:00.000Z',
  flagged: false,
  draftState: 'none',
  ...extra,
});
const prefs = (nightly: Record<string, unknown> = {}) => parsePrefs({ threshold: 70, nightly });

test('stage 3 drafts at most maxDrafts matches, best first', () => {
  const rows = [row('A', 71), row('B', 90), row('C', 80), row('D', 75)];
  const { ids, limited } = draftCandidates(rows, prefs({ maxDrafts: 2 }), new Map());
  assert.deepEqual(ids, [rows[1].id, rows[2].id]);
  assert.equal(limited, 2, 'the rest wait for a later night');
});

test('only found, undrafted, ungated matches at or over the threshold are candidates', () => {
  const rows = [
    row('A', 70),
    row('B', 69),
    row('C', null),
    row('D', 95, { gate: 'avoided company' }),
    row('E', 95, { status: 'drafted' }),
    row('F', 95, { draftState: 'failed' }),
  ];
  const { ids, limited } = draftCandidates(rows, prefs(), new Map());
  assert.deepEqual(ids, [rows[0].id]);
  assert.equal(limited, 0);
});

test('the company window holds back a third Uber posting', () => {
  const rows = [row('Uber', 90), row(' uber ', 85), row('Lyft', 80)];
  const { ids, limited } = draftCandidates(rows, prefs(), new Map([['uber', 1]]));
  assert.deepEqual(ids, [rows[0].id, rows[2].id], 'one Uber in the window plus one tonight makes two');
  assert.equal(limited, 1);
  assert.deepEqual(
    draftCandidates([row('Uber', 90), row('Uber', 85), row('Uber', 80)], prefs(), new Map()).limited,
    1,
    'two tonight, the third held back',
  );
});

test('maxDrafts 0 drafts nothing', () => {
  assert.deepEqual(draftCandidates([row('A', 90)], prefs({ maxDrafts: 0 }), new Map()), { ids: [], limited: 1 });
});
