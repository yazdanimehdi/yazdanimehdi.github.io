import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, hardGate, normalizeUrl, postingKey } from './match';
import { parsePrefs } from './settings';
import type { RawPosting } from './types';

const posting = (over: Partial<RawPosting> = {}): RawPosting => ({
  source: 'test',
  externalId: '1',
  company: 'Acme',
  title: 'Data Scientist',
  url: 'https://acme.com/jobs/1',
  description: 'Build models.',
  format: 'text',
  ...over,
});

test('same posting with tracking params has one key', () => {
  const a = { company: 'Acme', title: 'Data Scientist', url: 'https://Acme.com/jobs/1?utm_source=x#apply' };
  const b = { ...a, url: 'https://acme.com/jobs/1/' };
  assert.equal(postingKey(a), postingKey(b));
  assert.match(postingKey(a), /^[0-9a-f]{32}$/);
});

test('different titles at one company have different keys', () => {
  const url = 'https://acme.com/jobs/1';
  assert.notEqual(
    postingKey({ company: 'Acme', title: 'Data Scientist', url }),
    postingKey({ company: 'Acme', title: 'Data Engineer', url }),
  );
});

test('a careers-page key ignores the extracted title', () => {
  const url = 'https://acme.test/jobs/42';
  assert.equal(
    postingKey({ source: 'careers-page', company: 'Acme', title: 'ML Engineer', url }),
    postingKey({ source: 'careers-page', company: 'Acme', title: 'Machine Learning Engineer', url }),
  );
});

test('normalizeUrl keeps meaningful query params', () => {
  assert.equal(normalizeUrl('https://A.com/j?id=5&ref=x&utm_medium=y&source=z'), 'https://a.com/j?id=5');
});

test('avoided company is gated', () => {
  const prefs = parsePrefs({ avoidCompanies: ['ACME Inc.'] });
  assert.equal(hardGate(posting({ company: 'acme inc' }), prefs), 'company on your avoid list');
  assert.equal(hardGate(posting(), prefs), null);
});

test('deal-breaker matches whole phrases in title or text', () => {
  const prefs = parsePrefs({ dealBreakers: ['C++', 'on-site', 'sales'] });
  assert.equal(hardGate(posting({ description: 'Strong C++ needed' }), prefs), 'deal-breaker: C++');
  assert.equal(hardGate(posting({ title: 'ON-SITE Analyst' }), prefs), 'deal-breaker: on-site');
  assert.equal(hardGate(posting({ description: 'We value wholesales' }), prefs), null);
});

test('not remote', () => {
  const prefs = parsePrefs({ remote: 'remote' });
  assert.equal(hardGate(posting({ remote: false }), prefs), 'not remote');
  assert.equal(hardGate(posting({ remote: true }), prefs), null);
  assert.equal(hardGate(posting(), prefs), null);
});

test('location mismatch is gated; remote and unknown pass', () => {
  const prefs = parsePrefs({ locations: ['Berlin'] });
  assert.equal(hardGate(posting({ location: 'Paris, France' }), prefs), 'location');
  assert.equal(hardGate(posting({ location: 'Berlin, Germany' }), prefs), null);
  assert.equal(hardGate(posting({ location: 'Paris', remote: true }), prefs), null);
});

test('unknown location passes', () => {
  assert.equal(hardGate(posting(), parsePrefs({ locations: ['Berlin'] })), null);
});

test('below salary floor', () => {
  const prefs = parsePrefs({ salaryFloor: { amount: 100000, currency: 'EUR', period: 'year' } });
  const pay = (max?: number, currency = 'EUR', period: 'year' | 'month' = 'year') =>
    posting({ salary: { max, currency, period } });
  assert.equal(hardGate(pay(80000), prefs), 'below salary floor');
  assert.equal(hardGate(pay(120000), prefs), null);
  assert.equal(hardGate(pay(), prefs), null);
  assert.equal(hardGate(pay(5000, 'USD'), prefs), null);
  assert.equal(hardGate(pay(5000, 'EUR', 'month'), prefs), null);
});

test('fold strips accents', () => {
  assert.equal(fold('Zürich'), fold('Zurich'));
  const u = 'https://c.com/j';
  assert.equal(
    postingKey({ company: 'Café', title: 'Chef', url: u }),
    postingKey({ company: 'Cafe', title: 'Chef', url: u }),
  );
});

test('accented location matches', () => {
  assert.equal(hardGate(posting({ location: 'Zürich' }), parsePrefs({ locations: ['zurich'] })), null);
  assert.equal(hardGate(posting({ location: 'Paris' }), parsePrefs({ locations: ['  ', ''] })), null);
});

test('deal-breaker java does not match JavaScript', () => {
  const prefs = parsePrefs({ dealBreakers: ['java'] });
  assert.equal(hardGate(posting({ description: 'JavaScript only' }), prefs), null);
  assert.equal(hardGate(posting({ description: 'Java only' }), prefs), 'deal-breaker: java');
});

test('normalizeUrl leaves non-http URLs alone', () => {
  assert.equal(normalizeUrl(' mailto:a@b.com '), 'mailto:a@b.com');
});

test('google-jobs keys ignore the apply link, so one job found via two links is one posting', () => {
  const a = {
    source: 'google-jobs',
    company: 'Uber',
    title: 'Senior Scientist - Marketplace',
    location: 'New York, NY',
    url: 'https://a.test/1',
  };
  assert.equal(postingKey(a), postingKey({ ...a, url: 'https://b.test/2' }));
  assert.notEqual(postingKey(a), postingKey({ ...a, location: 'San Francisco, CA' }));
  const g = { source: 'greenhouse', company: 'Uber', title: 'X', location: 'NY', url: 'https://a.test/1' };
  assert.notEqual(postingKey(g), postingKey({ ...g, url: 'https://b.test/2' }), 'other sources still key on the URL');
});
