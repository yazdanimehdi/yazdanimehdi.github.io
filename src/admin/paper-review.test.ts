import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTicked, displayValue, sourceLabel } from './paper-review';

test('displayValue joins arrays, shows a dash for nothing, and stringifies the rest', () => {
  assert.equal(displayValue('authors', ['A. One', 'B. Two']), 'A. One, B. Two');
  assert.equal(displayValue('title', undefined), '—');
  assert.equal(displayValue('title', null), '—');
  assert.equal(displayValue('doi', ''), '—');
  assert.equal(displayValue('authors', []), '—');
  assert.equal(displayValue('year', 2024), '2024');
  assert.equal(displayValue('abstract', 'Text <b>x</b>'), 'Text <b>x</b>');
});

test('defaultTicked: only fills, and never from the PDF', () => {
  assert.equal(defaultTicked({ field: 'doi', from: '', to: 'x', fill: true, source: 'crossref' }), true);
  assert.equal(defaultTicked({ field: 'doi', from: '', to: 'x', fill: true }), true);
  assert.equal(defaultTicked({ field: 'doi', from: '', to: 'x', fill: true, source: 'pdf' }), false);
  assert.equal(defaultTicked({ field: 'title', from: 'a', to: 'b', fill: false, source: 'arxiv' }), false);
});

test('sourceLabel names each source', () => {
  assert.equal(sourceLabel('arxiv'), 'arXiv');
  assert.equal(sourceLabel('biorxiv'), 'bioRxiv');
  assert.equal(sourceLabel('medrxiv'), 'medRxiv');
  assert.equal(sourceLabel('crossref'), 'Crossref');
  assert.equal(sourceLabel('pubmed'), 'PubMed');
  assert.equal(sourceLabel('openalex'), 'OpenAlex');
  assert.equal(sourceLabel('pdf'), 'your PDF');
  assert.equal(sourceLabel(undefined), '');
});
