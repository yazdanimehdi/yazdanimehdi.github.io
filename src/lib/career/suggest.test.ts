import test from 'node:test';
import assert from 'node:assert/strict';
import type { CvConfig } from '../types';
import { validatePrefs } from './settings';
import { contactAnswers, parseSuggestion, suggestPrompt } from './suggest';

test('parseSuggestion caps, cleans and dedupes', () => {
  const s = parseSuggestion(
    JSON.stringify({
      roles: [
        'Research Scientist',
        'research scientist',
        'x'.repeat(61),
        ...Array(10)
          .fill('ML Engineer')
          .map((r, i) => `${r} ${i}`),
      ],
      keywords: ['Python​'],
      seniority: [],
      fields: [],
      locations: ['Orlando, FL'],
      languages: [{ language: 'Farsi', level: 'native' }],
    }),
  );
  assert.equal(s.roles.length, 8);
  assert.equal(s.roles[0], 'Research Scientist');
  assert.equal(s.roles.filter((r) => /research scientist/i.test(r)).length, 1);
  assert.deepEqual(s.keywords, ['Python']);
  assert.doesNotThrow(() => validatePrefs({ ...s }));
  assert.throws(() => parseSuggestion('not json'));
});

test('contactAnswers copies contact details from the CV without AI', () => {
  const a = contactAnswers({
    cv: {
      name: 'M',
      phone: '+1 407 555 0100',
      location: 'Orlando, FL',
      socialNetworks: [{ network: 'LinkedIn', username: 'me' }],
      sections: {},
    },
  } as CvConfig);
  assert.equal(a.phone, '+1 407 555 0100');
  assert.equal(a.address, 'Orlando, FL');
  assert.deepEqual(
    a.links.map((l) => l.url),
    ['https://linkedin.com/in/me'],
  );
  const known = contactAnswers({
    cv: {
      name: 'M',
      socialNetworks: [
        { network: 'ORCID', username: '0000-0001-2345-6789' },
        { network: 'Google Scholar', username: 'abc123' },
        { network: 'Mastodon', username: 'me' },
      ],
      sections: {},
    },
  } as CvConfig);
  assert.deepEqual(known.links, [
    { label: 'ORCID', url: 'https://orcid.org/0000-0001-2345-6789' },
    { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=abc123' },
  ]);
  const w = contactAnswers({ cv: { name: 'M', website: 'https://me.test', sections: {} } } as CvConfig);
  assert.deepEqual(w, { phone: '', address: '', links: [{ label: 'Website', url: 'https://me.test' }] });
});

test('suggestPrompt sends at most 40 papers with abstracts cut to 200 characters', () => {
  const papers = Array.from({ length: 45 }, (_, i) => ({ title: `Paper ${i}`, abstract: 'a'.repeat(300) }));
  const { prompt } = suggestPrompt('CV TEXT', papers);
  assert.match(prompt, /CV TEXT/);
  assert.match(prompt, /Paper 39\b/);
  assert.doesNotMatch(prompt, /Paper 40\b/);
  assert.ok(prompt.includes('a'.repeat(200)) && !prompt.includes('a'.repeat(201)));
});
