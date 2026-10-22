import test from 'node:test';
import assert from 'node:assert/strict';
import { papersDue } from './papers';
import { resolveAiConfig } from '../ai/providers';

test('papersDue', () => {
  const mon = new Date('2026-10-19T03:00:00Z'),
    tue = new Date('2026-10-20T03:00:00Z'),
    first = new Date('2026-11-01T03:00:00Z'),
    sun = new Date('2026-10-18T03:00:00Z');
  assert.equal(papersDue({ every: 'day' }, tue), true);
  assert.equal(papersDue({ every: 'off' }, mon), false);
  assert.equal(papersDue({ every: 'week', weekday: 1 }, mon), true);
  assert.equal(papersDue({ every: 'week', weekday: 1 }, tue), false);
  assert.equal(papersDue({ every: 'week', weekday: 0 }, sun), true);
  assert.equal(papersDue({ every: 'week' }, mon), true, 'weekday defaults to Monday');
  assert.equal(papersDue({ every: 'month', monthday: 1 }, first), true);
  assert.equal(papersDue({ every: 'month', monthday: 1 }, tue), false);
});

test('resolveAiConfig schedule: default day, invalid falls back', () => {
  assert.deepEqual(resolveAiConfig({}).papers.schedule, { every: 'day' });
  assert.deepEqual(resolveAiConfig({ papers: { schedule: { every: 'hourly' } } }).papers.schedule, { every: 'day' });
  assert.deepEqual(resolveAiConfig({ papers: { schedule: { every: 'week', weekday: 9 } } }).papers.schedule, {
    every: 'week',
    weekday: 1,
  });
  assert.deepEqual(resolveAiConfig({ papers: { schedule: { every: 'month', monthday: 15 } } }).papers.schedule, {
    every: 'month',
    monthday: 15,
  });
});
