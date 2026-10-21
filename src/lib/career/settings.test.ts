import test from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'astro/zod';
import { parseAnswers, parsePrefs, validateAnswers, validatePrefs } from './settings';

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

test('parsers return defaults for arrays and other non-objects', () => {
  for (const raw of [[], [1], 'x', 3, null]) {
    assert.deepEqual(parsePrefs(raw), parsePrefs({}));
    assert.deepEqual(parseAnswers(raw), parseAnswers({}));
  }
});

test('URL fields: lenient drops non-http(s) entries, strict rejects them', () => {
  const bad = ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'nope'];
  const p = parsePrefs({ watched: ['https://a.test/jobs', ...bad], feeds: ['http://b.test/rss', 5] });
  assert.deepEqual(p.watched, ['https://a.test/jobs']);
  assert.deepEqual(p.feeds, ['http://b.test/rss']);
  assert.deepEqual(
    parseAnswers({
      links: [
        { label: 'x', url: 'javascript:1' },
        { label: 'ok', url: 'https://c.test' },
      ],
    }).links,
    [{ label: 'ok', url: 'https://c.test' }],
  );
  for (const url of bad) {
    assert.throws(() => validatePrefs({ watched: [url] }), ZodError);
    assert.throws(() => validatePrefs({ feeds: [url] }), ZodError);
    assert.throws(() => validateAnswers({ links: [{ label: 'x', url }] }), ZodError);
  }
  assert.deepEqual(validatePrefs({ watched: ['https://a.test'] }).watched, ['https://a.test']);
});

test('strict eeo rejects bad fields; lenient defaults them per field', () => {
  const raw = { eeo: { mode: 'answer', gender: 5 } };
  assert.throws(
    () => validateAnswers(raw),
    (e) => e instanceof ZodError && e.issues[0].path[0] === 'eeo',
  );
  assert.deepEqual(parseAnswers(raw).eeo, { mode: 'answer', gender: '', race: '', veteran: '', disability: '' });
  assert.equal(validateAnswers({}).eeo.mode, 'decline');
});
