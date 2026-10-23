import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseDocuments } from './content/documents';
import {
  backlinksOf,
  excerpt,
  graphDocument,
  publicGraph,
  publicZipFiles,
  renderPublicBody,
  vaultZipResponse,
  type PublicEntry,
} from './public-notes';
import { publishedCopy, type PublicNote } from './reading/publish';
import { unzip } from './reading/test-unzip';
import { zip } from './reading/vault-zip';

const entry = (title: string, o: { kind?: 'note' | 'paper'; links?: string[]; body?: string } = {}): PublicEntry => {
  const slug = title.toLowerCase();
  const kind = o.kind ?? 'note';
  const data = { id: randomUUID(), kind, title, shared: new Date(), updated: new Date(), links: o.links ?? [] };
  return {
    id: slug,
    kind,
    data:
      kind === 'paper'
        ? { ...data, kind, paper: { title, authors: [], url: 'https://x.test' }, highlights: [] }
        : { ...data, kind },
    body: o.body ?? '',
    url: `/${kind === 'paper' ? 'readings' : 'notes'}/${slug}/`,
  };
};
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

test('renderPublicBody: a link to a public entry is a page link; one to a missing entry is its text', async () => {
  const alpha = entry('Alpha');
  const e = entry('Here', { body: 'See [[alpha|a]], [[ ALPHA ]] and [[Gone]].' });
  const html = await renderPublicBody(e, [alpha, e]);
  assert.match(html, /<a href="\/notes\/alpha\/">a<\/a>/);
  assert.match(html, /<a href="\/notes\/alpha\/">ALPHA<\/a>/);
  assert.match(html, /and Gone\./);
  assert.deepEqual(hrefs(html), ['/notes/alpha/', '/notes/alpha/']);
});

test('renderPublicBody: the shown text cannot open another link or inject HTML', async () => {
  const alpha = entry('Alpha');
  for (const body of [
    '[[Alpha|a]b]]',
    '[[Alpha|a\\]]](/evil)',
    '[[Gone|a\\]]](/evil)',
    '[[Alpha|[x]]](/evil)',
    '[[<img src=x onerror=alert(1)>]]',
    '[[Alpha|<b>bold</b>]]',
  ]) {
    const html = await renderPublicBody(entry('Here', { body }), [alpha]);
    assert.ok(
      hrefs(html).every((h) => h === '/notes/alpha/'),
      `${body} → ${html}`,
    );
    assert.doesNotMatch(html, /<(img|b)\b/, `${body} → ${html}`);
  }
});

test('backlinksOf: the entries linking to it, by title', () => {
  const target = entry('Target');
  const b = entry('Beta', { links: [target.data.id] });
  const a = entry('Alpha', { kind: 'paper', links: [target.data.id] });
  assert.deepEqual(
    backlinksOf(target, [target, b, entry('Other'), a]).map((e) => e.data.title),
    ['Alpha', 'Beta'],
  );
});

test('publicGraph: links counted both ways, each pair one edge, links to unknown uids dropped', () => {
  const a = entry('A');
  const b = entry('B', { kind: 'paper', links: [a.data.id, randomUUID()] });
  a.data.links = [b.data.id];
  const c = entry('C', { links: [a.data.id] });
  const g = publicGraph([a, b, c]);
  assert.deepEqual(
    g.nodes.map((n) => [n.title, n.kind, n.links, n.href, n.id]),
    [
      ['A', 'free', 3, '/notes/a/', a.data.id],
      ['B', 'paper', 2, '/readings/b/', b.data.id],
      ['C', 'free', 1, '/notes/c/', c.data.id],
    ],
  );
  assert.deepEqual(g.edges, [
    [0, 1],
    [0, 2],
  ]);
});

test('excerpt: plain text, wikilinks as their shown text, cut at 280 with …', () => {
  assert.equal(
    excerpt('# Title\n\nSee [[Alpha|the alpha]] and [[Beta]], **bold** [a link](https://x.test).'),
    'Title See the alpha and Beta, bold a link.',
  );
  const long = excerpt('word '.repeat(100));
  assert.equal([...long].length, 280);
  assert.ok(long.endsWith('…'));
  assert.equal(excerpt('short'), 'short');
});

test('a published copy parses as a notes or readings document', () => {
  const base: PublicNote = {
    uid: randomUUID(),
    kind: 'free',
    title: 'My Idea',
    body: 'Links to [[Other]] and [[Secret]].',
    slug: 'my-idea',
    sharedAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };
  const other = randomUUID();
  const targets = new Map([['other', other]]);
  const [note] = parseDocuments('notes', [publishedCopy(base, targets)]);
  assert.equal(note.id, 'my-idea');
  assert.deepEqual(note.data, {
    id: base.uid,
    kind: 'note',
    title: 'My Idea',
    shared: new Date(base.sharedAt),
    updated: new Date(base.updatedAt),
    links: [other],
  });
  assert.equal(note.body, 'Links to [[Other]] and (private note).');

  const paper: PublicNote = {
    ...base,
    uid: randomUUID(),
    kind: 'paper',
    slug: 'deep-folds',
    paper: {
      title: 'Deep Folds',
      authors: ['A. Author'],
      url: 'https://arxiv.org/abs/1',
      arxiv: '1',
      doi: null,
      publishedAt: '2024-05-06',
    },
    highlights: [{ pid: 'p1', quote: 'A quote', comment: 'Mine' }],
  };
  const [reading] = parseDocuments('readings', [publishedCopy(paper, targets)]);
  assert.equal(reading.id, 'deep-folds');
  assert.equal(reading.data.kind, 'paper');
  assert.deepEqual((reading.data.paper as { published: Date }).published, new Date('2024-05-06'));
  assert.equal((reading.data.highlights as unknown[]).length, 1);
  const err = mock.method(console, 'error', () => {});
  assert.equal(parseDocuments('notes', [publishedCopy(paper, targets)]).length, 0, 'a paper is not a note');
  const unsafe = { ...paper, paper: { ...paper.paper!, url: 'javascript:alert(1)' } };
  assert.equal(parseDocuments('readings', [publishedCopy(unsafe, targets)]).length, 0, 'a Source link is http(s)');
  err.mock.restore();
});

// A paper with a highlight, and two notes: A links to B and to a uid no public entry has.
const three = () => {
  const p = entry('Paper', { kind: 'paper', body: 'On [[B]].' });
  if (p.data.kind === 'paper') {
    p.data.paper = {
      title: 'Deep Folds',
      authors: ['A. Author'],
      url: 'https://arxiv.org/abs/1',
      arxiv: '1',
      published: new Date('2024-05-06'),
    };
    p.data.highlights = [{ quote: 'A quote', where: 'p. 1', comment: 'Mine' }];
  }
  const b = entry('B', { body: 'Plain.' });
  const a = entry('A', { links: [b.data.id, randomUUID()], body: 'To [[B]].' });
  p.data.links = [b.data.id];
  return { p, a, b, all: [p, b, a] };
};
const site = { name: 'Jane Smith', url: 'https://jane.test', owner: 'Jane Smith' };

test("graphDocument: version 1, notes by title with absolute urls, the paper's highlights, links both ends known", () => {
  const { p, a, b, all } = three();
  const doc = graphDocument(all, site);
  assert.equal(doc.format, 'scholaros-notes');
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.site, site);
  assert.deepEqual(
    doc.notes.map((n) => [n.title, n.kind, n.url]),
    [
      ['A', 'note', 'https://jane.test/notes/a/'],
      ['B', 'note', 'https://jane.test/notes/b/'],
      ['Paper', 'paper', 'https://jane.test/readings/paper/'],
    ],
  );
  assert.deepEqual(doc.notes[0], {
    id: a.data.id,
    kind: 'note',
    title: 'A',
    url: 'https://jane.test/notes/a/',
    shared: a.data.shared.toISOString(),
    updated: a.data.updated.toISOString(),
    body: 'To [[B]].',
  });
  assert.deepEqual(doc.notes[2].paper, {
    title: 'Deep Folds',
    authors: ['A. Author'],
    url: 'https://arxiv.org/abs/1',
    arxiv: '1',
    published: '2024-05-06',
  });
  assert.deepEqual(doc.notes[2].highlights, [{ quote: 'A quote', where: 'p. 1', comment: 'Mine' }]);
  assert.deepEqual(
    doc.links,
    [
      [a.data.id, b.data.id],
      [p.data.id, b.data.id],
    ].sort((x, y) => x[0].localeCompare(y[0])),
  );
  assert.equal(JSON.parse(JSON.stringify(doc)).notes[0].shared, a.data.shared.toISOString());
});

test('publicZipFiles: notes/ and readings/ by vault title, each its front matter with a source line, then its body', () => {
  const { all } = three();
  const files = unzip(zip(publicZipFiles(all, 'https://jane.test')));
  assert.deepEqual(files.map((f) => f.path).sort(), ['notes/A.md', 'notes/B.md', 'readings/Paper.md']);
  const a = files.find((f) => f.path === 'notes/A.md')!;
  assert.match(a.text, /^---\nid: [0-9a-f-]+\nkind: note\ntitle: A\n/);
  assert.match(a.text, /\nsource: https:\/\/jane\.test\/notes\/a\/\n---\n\nTo \[\[B\]\]\.$/);
  const paper = files.find((f) => f.path === 'readings/Paper.md')!;
  const [parsed] = parseDocuments('readings', [{ path: paper.path, content: paper.text }]);
  assert.equal((parsed.data.highlights as unknown[]).length, 1);
  assert.match(paper.text, /\n {2}published: 2024-05-06\n/);
  assert.deepEqual((parsed.data.paper as { published: Date }).published, new Date('2024-05-06'));
  assert.match(paper.text, /\nsource: https:\/\/jane\.test\/readings\/paper\/\n/);
});

test('vaultZipResponse: the zip as a download; over the cap, 413 with the reason', async () => {
  const { all } = three();
  const ok = vaultZipResponse(all, 'https://jane.test', 'jane-smith-notes.zip');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'application/zip');
  assert.equal(ok.headers.get('Content-Disposition'), 'attachment; filename="jane-smith-notes.zip"');
  assert.equal(unzip(new Uint8Array(await ok.arrayBuffer())).length, 3);
  const over = vaultZipResponse(all, 'https://jane.test', 'x.zip', 10);
  assert.equal(over.status, 413);
  assert.match(await over.text(), /^The notes’ zip is 0\.\d MB, over the 4\.4 MB one download can carry\.$/);
});
