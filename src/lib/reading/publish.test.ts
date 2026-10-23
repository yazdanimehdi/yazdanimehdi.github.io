import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../admin/serialize';
import { publishedCopy, stripPrivateLinks, type PublicNote } from './publish';
import { linkKey, wikiLinks } from './vault-links';

const PUB = '6f1c2a4e-8b3d-4c5e-9a7f-1d2e3f4a5b6c';
const targets = new Map([[linkKey('Public Idea'), PUB]]);

const freeNote = (o: Partial<PublicNote> = {}): PublicNote => ({
  uid: '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b',
  kind: 'free',
  title: 'My note',
  body: 'Some thoughts.',
  slug: 'my-note',
  sharedAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  ...o,
});
const paperNote = (o: Partial<PublicNote> = {}): PublicNote => ({
  ...freeNote(),
  uid: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
  kind: 'paper',
  title: 'Attention Is All You Need',
  slug: 'paper-slug',
  paper: {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    url: 'https://arxiv.org/abs/1706.03762',
    arxiv: '1706.03762',
    doi: null,
    publishedAt: null,
  },
  highlights: [],
  ...o,
});

test('links to public notes stay; private ones lose their target', () => {
  assert.equal(
    stripPrivateLinks('See [[Public Idea]], [[Secret|my alias]], [[Secret]], [[Secret#Part]], ![[Secret]].', targets),
    'See [[Public Idea]], my alias, (private note), (private note), (private note).',
  );
  assert.equal(stripPrivateLinks('[[Secret#Part|shown]] [[Secret|]]', targets), 'shown (private note)');
});
test('stripping never leaves a new link to a private note behind', () => {
  for (const input of [
    '[[A|[[Other Secret]]]]',
    '[[A|x[]][Other Secret]]',
    '[[[[Secret]]]]',
    // A public link whose alias or heading holds `[[`: the private title would be its visible text.
    '[[Public Idea|[[Secret]]]]',
    '[[Public Idea|x [[Secret]] y]]',
    '[[Public Idea#[[Secret]]]]',
    '[[Public Idea#h|[[Secret|alias]]]]',
    '![[Public Idea|[[Secret]]]]',
  ]) {
    const out = stripPrivateLinks(input, targets);
    assert.ok(
      wikiLinks(out).every((t) => targets.has(linkKey(t))),
      `${input} → ${out}`,
    );
    assert.equal(stripPrivateLinks(out, targets), out);
    assert.ok(!out.includes('Secret'), `${input} → ${out}`);
  }
});
test('case and whitespace variants of a private title are stripped too', () => {
  assert.equal(stripPrivateLinks('[[ secret   NOTE ]] `[[Secret]]`', new Map()), '(private note) `(private note)`');
});
test('a link to a public note keeps its alias and heading', () => {
  assert.equal(stripPrivateLinks('[[public idea#Why|why]]', targets), '[[public idea#Why|why]]');
  assert.equal(stripPrivateLinks('![[Public Idea#Why [x]|why (y)]]', targets), '![[Public Idea#Why [x]|why (y)]]');
});
test('a free note copy: path, front matter, links', () => {
  const { path, content } = publishedCopy(freeNote({ body: 'x [[Public Idea]] [[Public Idea]] [[Secret]]' }), targets);
  assert.equal(path, 'src/content/notes/my-note.md');
  const { data, body } = parseMarkdown(content);
  assert.deepEqual(Object.keys(data), ['id', 'kind', 'title', 'shared', 'updated', 'links']);
  assert.deepEqual(data.links, [PUB]);
  assert.equal(data.kind, 'note');
  assert.equal(body.trim(), 'x [[Public Idea]] [[Public Idea]] (private note)');
  assert.ok(!content.includes('Secret'));
});
test('a note never lists itself among its links', () => {
  const self = freeNote({ uid: PUB, body: '[[Public Idea]] [[public idea]]' });
  assert.deepEqual(parseMarkdown(publishedCopy(self, targets).content).data.links, []);
});
test('a paper copy carries metadata and at most 10 highlights, each at most 300 characters', () => {
  const long = 'a'.repeat(400);
  const { path, content } = publishedCopy(
    paperNote({
      highlights: Array.from({ length: 12 }, (_, i) => ({
        pid: 'S2.p3',
        quote: i ? 'q' : long,
        comment: i === 1 ? 'mine' : '',
      })),
    }),
    targets,
  );
  assert.equal(path, 'src/content/readings/paper-slug.md');
  const data = parseMarkdown(content).data as {
    paper: Record<string, string>;
    highlights: { quote: string; where: string; comment?: string }[];
  };
  assert.equal(data.highlights.length, 10);
  assert.equal([...data.highlights[0].quote].length, 300);
  assert.ok(data.highlights[0].quote.endsWith('…'));
  assert.equal(data.highlights[0].where, '§2 ¶3');
  assert.deepEqual(Object.keys(data.highlights[0]), ['quote', 'where']);
  assert.equal(data.highlights[1].comment, 'mine');
  assert.equal(data.paper.url, 'https://arxiv.org/abs/1706.03762');
  assert.deepEqual(Object.keys(data.paper), ['title', 'authors', 'url', 'arxiv']);
});
test('a private link in a highlight quote or comment is stripped', () => {
  const { content } = publishedCopy(
    paperNote({ highlights: [{ pid: 'S1.p1', quote: 'as [[Secret]] says', comment: 'see [[Secret|there]]' }] }),
    targets,
  );
  const data = parseMarkdown(content).data as { highlights: { quote: string; comment: string }[] };
  assert.equal(data.highlights[0].quote, 'as (private note) says');
  assert.equal(data.highlights[0].comment, 'see there');
  assert.ok(!content.includes('Secret'));
});
test('the same note always gives the same bytes', () => {
  assert.equal(publishedCopy(freeNote(), targets).content, publishedCopy(freeNote(), targets).content);
});
