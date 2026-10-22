import test from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'astro/zod';
import { parseReadingPrefs, validateReadingPrefs } from './settings';

test('parseReadingPrefs fills the defaults', () => {
  assert.deepEqual(parseReadingPrefs({}), {
    field: '',
    keywords: [],
    area: '',
    sources: {
      arxiv: { on: false, categories: [] },
      biorxiv: { on: false, categories: [] },
      medrxiv: { on: false, categories: [] },
      pubmed: { on: false, query: '' },
      openalex: { on: false, topics: [] },
      huggingface: { on: false },
      bluesky: { on: true },
      alphaxiv: { on: false },
    },
    talked: 5,
    inField: 8,
    minScore: 60,
    maxAiCalls: 20,
    paused: false,
    email: { on: false, to: '', from: '' },
  });
  assert.deepEqual(parseReadingPrefs(null), parseReadingPrefs({}));
});

test('validateReadingPrefs rejects a bad arXiv category', () => {
  assert.throws(
    () => validateReadingPrefs({ sources: { arxiv: { on: true, categories: ['cs CL'] } } }),
    (e) => e instanceof ZodError && e.issues[0].path.join('.') === 'sources.arxiv.categories.0',
  );
  assert.deepEqual(
    validateReadingPrefs({ sources: { arxiv: { on: true, categories: ['cs.CL', 'hep-th'] } } }).sources.arxiv,
    {
      on: true,
      categories: ['cs.CL', 'hep-th'],
    },
  );
});

test('validateReadingPrefs rejects talked 21', () => {
  assert.throws(
    () => validateReadingPrefs({ talked: 21 }),
    (e) => e instanceof ZodError && e.issues[0].path[0] === 'talked',
  );
  assert.equal(validateReadingPrefs({ talked: 20 }).talked, 20);
});

test('parseReadingPrefs drops junk sources but keeps the rest', () => {
  const p = parseReadingPrefs({
    talked: 'x',
    inField: 3,
    sources: {
      openalex: {
        on: true,
        topics: [
          { id: 'x', name: 'Junk' },
          { id: 'subfields/1702', name: 'AI' },
        ],
      },
      pubmed: { on: 'yes', query: 'crispr' },
    },
  });
  assert.deepEqual(p.sources.openalex, { on: true, topics: [{ id: 'subfields/1702', name: 'AI' }] });
  assert.deepEqual(p.sources.pubmed, { on: false, query: 'crispr' });
  assert.equal(p.talked, 5);
  assert.equal(p.inField, 3);
});
