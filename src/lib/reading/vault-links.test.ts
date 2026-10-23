import test from 'node:test';
import assert from 'node:assert/strict';
import { addRelated, noteTitle, numberedTitle, rewriteLinks, wikiLinks } from './vault-links';

const bytes = (s: string) => new TextEncoder().encode(s).length;

test('noteTitle makes a title a file name', () => {
  assert.equal(noteTitle('Attention: Is All You Need?'), 'Attention Is All You Need');
  assert.equal(noteTitle('A/B [Re] #1'), 'A B Re 1');
  assert.equal(noteTitle('  ...  '), 'Untitled');
  assert.equal(noteTitle(''), 'Untitled');
  assert.equal(noteTitle('a\tb\u00a0\u0085c\\d*e|f^g<h>"i"'), 'a b c d e f g h i');
  assert.equal(noteTitle('x'.repeat(300)), 'x'.repeat(100));
  assert.equal(noteTitle('語'.repeat(100)), '語'.repeat(50));
  // Code points, never half a surrogate pair: 100 emoji are 400 bytes, so 50 stay.
  assert.equal(noteTitle('🙂'.repeat(120)), '🙂'.repeat(50));
  // The cut can leave a space or dot at the end; it goes too.
  assert.equal(noteTitle('a'.repeat(98) + ' .b'), 'a'.repeat(98));
});

test('numberedTitle fits the suffix inside the cap', () => {
  assert.equal(numberedTitle('Same', 2), 'Same (2)');
  assert.equal(numberedTitle('x'.repeat(100), 2), 'x'.repeat(96) + ' (2)');
  assert.equal(numberedTitle('x'.repeat(100), 12), 'x'.repeat(95) + ' (12)');
  const emoji = numberedTitle(noteTitle('🙂'.repeat(120)), 2);
  assert.equal(emoji, '🙂'.repeat(46) + ' (2)');
  assert.ok([...emoji].length <= 100 && bytes(emoji) <= 200);
  const cjk = numberedTitle('語'.repeat(66), 3);
  assert.ok([...cjk].length <= 100 && bytes(cjk) <= 200, cjk);
});

test('wikiLinks reads every link form', () => {
  assert.deepEqual(wikiLinks('[[A]] ![[B#h]] [[C|c]] [[ D  E ]] [[A]] [[x\ny]]'), ['A', 'B', 'C', 'D E']);
  assert.deepEqual(wikiLinks('no links, [single], [[ ]]'), []);
});

test('rewriteLinks keeps aliases and headings and leaves other notes alone', () => {
  assert.equal(
    rewriteLinks('[[Old]] [[old|shown]] [[Old#Method]] ![[Old]] [[ Old ]] [[Old notes]]', 'Old', 'New'),
    '[[New]] [[New|shown]] [[New#Method]] ![[New]] [[New]] [[Old notes]]',
  );
  assert.equal(rewriteLinks('[[Two  words]]', 'two words', 'One'), '[[One]]');
});

test('addRelated starts one Related line and extends it', () => {
  assert.equal(addRelated('', 'A'), 'Related: [[A]]');
  assert.equal(addRelated('My note.\n\n', 'A'), 'My note.\n\nRelated: [[A]]');
  assert.equal(addRelated('My note.\n\nRelated: [[A]]\n', 'B'), 'My note.\n\nRelated: [[A]], [[B]]');
  assert.equal(addRelated('Related: [[A]]', 'B'), 'Related: [[A]], [[B]]');
  assert.equal(
    addRelated('Related: [[A]]\n\nMore thoughts.', 'B'),
    'Related: [[A]], [[B]]\n\nMore thoughts.',
    'the Related line wherever it is, never a second one',
  );
});
