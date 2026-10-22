import test from 'node:test';
import assert from 'node:assert/strict';
import { authorsLine, dayLine, readingRunLine, readingRunNotes, thinLine } from './reading';
import type { ReadingRun } from '../lib/reading/types';

const run = (over: Partial<ReadingRun> = {}): ReadingRun => ({
  at: '2026-10-22T05:00:00Z',
  day: '2026-10-22',
  sources: [],
  ranked: 0,
  unranked: 0,
  aiCalls: 0,
  talked: 0,
  inField: 0,
  texts: { fetched: 0, failed: 0 },
  ...over,
});

test('readingRunLine: the two sections always, then found and texts fetched when not zero', () => {
  assert.equal(readingRunLine(run({ paused: true, talked: 3 })), 'Paused: nothing ran');
  const sources = [
    { id: 'arxiv', found: 400, added: 50 },
    { id: 'huggingface', found: 12, added: 2 },
  ];
  assert.equal(
    readingRunLine(run({ talked: 5, inField: 8, sources, texts: { fetched: 3, failed: 1 } })),
    '5 talked about · 8 in your field · 412 found · 3 texts fetched',
  );
  assert.equal(readingRunLine(run()), '0 talked about · 0 in your field');
});

test('readingRunNotes: a ranking stop, an email error and each source error, their text cleaned', () => {
  assert.deepEqual(readingRunNotes(run({ email: 'sent' })), []);
  assert.deepEqual(readingRunNotes(run({ email: 'skipped' })), []);
  assert.deepEqual(
    readingRunNotes(
      run({
        stopped: 'The AI provider is out of credit‮',
        email: 'Invalid `to` field',
        sources: [
          { id: 'arxiv', found: 0, added: 0, error: 'HTTP 503​' },
          { id: 'pubmed', found: 4, added: 4 },
          { id: 'openalex', found: 0, added: 0, error: 'HTTP 429' },
        ],
      }),
    ),
    [
      'Ranking stopped: The AI provider is out of credit. The rest are listed as not ranked tonight.',
      'The digest email wasn’t sent: Invalid `to` field',
      'arxiv: HTTP 503',
      'openalex: HTTP 429',
    ],
  );
});

test('thinLine: nothing for a full list; otherwise why the list is short, never padded', () => {
  assert.equal(thinLine('talked', 5, 5, 'Machine learning'), null);
  assert.equal(thinLine('field', 9, 8, ''), null);
  assert.equal(
    thinLine('talked', 2, 5, 'Machine learning'),
    'Only 2 papers in Machine learning had traction numbers from your sources today. The list is not padded.',
  );
  assert.equal(
    thinLine('talked', 1, 5, ''),
    'Only 1 paper in your area had traction numbers from your sources today. The list is not padded.',
  );
  assert.equal(
    thinLine('talked', 0, 5, 'Neuroscience'),
    'No paper in Neuroscience had traction numbers from your sources today.',
  );
  assert.equal(thinLine('field', 3, 8, 'x'), 'Only 3 new papers scored high enough today.');
  assert.equal(thinLine('field', 0, 8, 'x'), 'No new paper scored high enough today.');
});

test('authorsLine: up to three names, then et al.', () => {
  assert.equal(authorsLine([]), '');
  assert.equal(authorsLine(['A. Lovelace']), 'A. Lovelace');
  assert.equal(authorsLine(['A', 'B', 'C']), 'A, B, C');
  assert.equal(authorsLine(['A', 'B', 'C', 'D']), 'A, B, C et al.');
  assert.equal(authorsLine(['Ann‮']), 'Ann');
});

test('dayLine: the weekday, day and month, then how many papers', () => {
  assert.equal(dayLine('2026-10-21', 11), 'Wednesday 21 October · 11 papers');
  assert.equal(dayLine('2026-10-20', 1), 'Tuesday 20 October · 1 paper');
});
