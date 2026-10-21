import test from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'astro/zod';
import { parseAnswers, parsePrefs, validatePrefs } from './settings';

test('parsePrefs fills defaults and drops junk', () => {
  const p = parsePrefs({ threshold: 'x', roles: 'ML', extra: 1 });
  assert.equal(p.threshold, 70);
  assert.deepEqual(p.roles, []);
  assert.equal(p.remote, 'any');
  assert.equal(p.maxScoresPerRun, 100);
  assert.ok(!('extra' in p));
  assert.deepEqual(parsePrefs(null), parsePrefs({}));
});

test('parsePrefs keeps valid values next to bad ones', () => {
  const p = parsePrefs({
    roles: ['ML'],
    remote: 'hybrid',
    salaryFloor: { amount: 'x' },
    sources: { adzuna: { on: true } },
  });
  assert.deepEqual(p.roles, ['ML']);
  assert.equal(p.remote, 'hybrid');
  assert.equal(p.salaryFloor, null);
  assert.deepEqual(p.sources, { adzuna: { on: true } });
});

test('validatePrefs rejects a threshold over 100', () => {
  assert.throws(
    () => validatePrefs({ threshold: 101 }),
    (e) => e instanceof ZodError && e.issues[0].path[0] === 'threshold',
  );
});

test('EEO defaults to decline', () => {
  assert.equal(parseAnswers({}).eeo.mode, 'decline');
});
