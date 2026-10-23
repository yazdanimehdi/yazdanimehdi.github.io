import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArxiv, overlap, paperKey, topByOverlap } from './match';

test('normalizeArxiv drops the prefix and version', () => {
  assert.equal(normalizeArxiv('2610.28673v2'), '2610.28673');
  assert.equal(normalizeArxiv('arXiv:hep-th/9901001v1'), 'hep-th/9901001');
});

test('paperKey maps an arXiv DOI to the arXiv key', () => {
  assert.equal(paperKey({ doi: '10.48550/arXiv.2610.14224' }), 'arxiv:2610.14224');
  assert.equal(paperKey({ doi: '10.48550/ARXIV.2610.14224' }), 'arxiv:2610.14224');
});

test('paperKey prefers arxiv, then doi lowercased, then pmid', () => {
  assert.equal(paperKey({ arxiv: '2610.1v3', doi: '10.1/X', pmid: '7' }), 'arxiv:2610.1');
  assert.equal(paperKey({ doi: '10.1101/AbC', pmid: '7' }), 'doi:10.1101/abc');
  assert.equal(paperKey({ pmid: '7' }), 'pmid:7');
  assert.equal(paperKey({}), null);
});

test('overlap counts title hits double', () => {
  const p = {
    title: 'Protein folding with diffusion',
    abstract: 'We fold proteins. Diffusion models, diffusion everywhere.',
  };
  // 'diffusion': title 2 + abstract 1 (once per field); 'protein': title 2 (not 'proteins'); 'GPT-4': none
  assert.equal(overlap(p, ['Diffusion', 'protein', 'GPT-4']), 5);
  assert.equal(overlap({ title: 'Scaling GPT-4 evals', abstract: null }, ['gpt-4']), 2);
});

test('overlap ignores blank keywords', () => {
  assert.equal(overlap({ title: 'A title: two', abstract: 'An abstract - yes' }, ['', '   ']), 0);
});

test('topByOverlap keeps feed order among equals', () => {
  const items = [
    { id: 'a', s: 1 },
    { id: 'b', s: 3 },
    { id: 'c', s: 1 },
    { id: 'd', s: 3 },
  ];
  assert.deepEqual(
    topByOverlap(items, (i) => i.s).map((i) => i.id),
    ['b', 'd', 'a', 'c'],
  );
  assert.deepEqual(
    topByOverlap(items, (i) => i.s, 3).map((i) => i.id),
    ['b', 'd', 'a'],
  );
});
