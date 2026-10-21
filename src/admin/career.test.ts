import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFeed } from './career';
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
