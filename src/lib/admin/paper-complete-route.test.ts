import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SourceError } from '../career/sources/http';
import { readEntry } from './content';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import type { Lookup, PaperProposal } from './paper-complete';
import { setPaperLookupForTests } from './papers';
import { SCHOLAR_JSON } from './paths';
import { GET, POST } from '../../admin/routes/api/papers/complete';

const MIRAGE = 'MIRAGE: Measuring Interpolation and Redundancy in Affinity GEneralization';
const SCHOLAR_URL = 'https://scholar.google.com/citations?view_op=view_citation&citation_for_view=AUTH:m';
let store: MemoryStore;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-'));
  const dir = path.join(root, 'src/content/publications');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'yazdanijahromi2026mirage.md'),
    `---\ntitle: '${MIRAGE}'\nauthors: ['M Yazdani-Jahromi', 'S Padhi', 'I Garibay']\nvenue: 'arXiv'\nyear: 2026\n` +
      `url: '${SCHOLAR_URL}'\ntype: 'preprint'\nfeatured: true\nimage: './mirage.png'\ntopic: 'drug-discovery'\n---\n\nOwner notes.\n`,
  );
  store = new MemoryStore(root);
  setStoreForTests(() => store);
  const fixture = fs.readFileSync(new URL('../../../tests/fixtures/papers/arxiv-mirage.xml', import.meta.url), 'utf8');
  const lookup: Lookup = {
    async get(url) {
      if (url.startsWith('https://export.arxiv.org/api/query?search_query=')) return fixture;
      throw new SourceError(`${url} answered 404`, 404);
    },
  };
  setPaperLookupForTests(lookup);
});
after(() => {
  setStoreForTests(null);
  setPaperLookupForTests(null);
});

function call(handler: typeof GET, opts: { query?: string; body?: unknown } = {}): Promise<Response> {
  const url = new URL(`https://site.test/api/admin/papers/complete${opts.query ?? ''}`);
  const method = opts.body === undefined ? 'GET' : 'POST';
  const request = new Request(url, { method, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const locals = { user: { login: 'jane', name: 'Jane', avatar: '' } };
  return Promise.resolve(handler({ request, url, params: {}, locals } as never));
}

const SLUG = 'yazdanijahromi2026mirage';
const fields = (p: PaperProposal) => p.changes.map((c) => c.field);

test('GET proposes completions for existing papers and writes nothing', async () => {
  const res = await call(GET, { query: '?offset=0&limit=50' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.total, body.offset, body.proposals.length], [1, 1, 1]);
  const [p] = body.proposals as PaperProposal[];
  assert.equal(p.slug, SLUG);
  const by = Object.fromEntries(p.changes.map((c) => [c.field, c]));
  assert.equal(by.authors.fill, false);
  assert.deepEqual(by.authors.to, ['Mehdi Yazdani-Jahromi', 'Sanjay Padhi', 'Ivan Garibay']);
  assert.equal(by.arxiv.fill, true);
  assert.equal(by.arxiv.source, 'arxiv');
  assert.deepEqual([by.url.from, by.url.to], [SCHOLAR_URL, 'https://arxiv.org/abs/2609.14491']);
  assert.ok(!by.title && !by.venue && !by.type && !by.year, 'unchanged fields are not proposed');
  assert.equal(store.log.length, 0, 'no commit');

  const past = await (await call(GET, { query: '?offset=1' })).json();
  assert.deepEqual([past.total, past.offset, past.proposals], [1, 1, []]);
});

test('POST applies the approved fields and remembers the declined ones, in one commit', async () => {
  const res = await call(POST, {
    body: {
      slug: SLUG,
      apply: ['arxiv', 'authors'],
      decline: [{ field: 'url', value: 'https://arxiv.org/abs/2609.14491' }],
    },
  });
  assert.equal(res.status, 200);
  const left = fields(await res.json());
  assert.ok(!left.includes('arxiv') && !left.includes('authors') && !left.includes('url'), left.join());
  assert.equal(store.log.length, 1, 'one commit');

  const entry = (await readEntry(store, 'publications', SLUG))!;
  assert.equal(entry.data.arxiv, '2609.14491');
  assert.deepEqual(entry.data.authors, ['Mehdi Yazdani-Jahromi', 'Sanjay Padhi', 'Ivan Garibay']);
  assert.equal(entry.data.url, SCHOLAR_URL, 'declined, not written');
  assert.deepEqual(
    [entry.data.topic, entry.data.featured, entry.data.image, entry.data.abstract],
    ['drug-discovery', true, './mirage.png', undefined],
  );
  assert.equal(entry.body.trim(), 'Owner notes.');
  const state = JSON.parse((await store.read(SCHOLAR_JSON))!.content);
  assert.deepEqual(state.declined, { [SLUG]: { url: JSON.stringify('https://arxiv.org/abs/2609.14491') } });
  assert.equal(state.lastRun, undefined, 'a decline before the first sync keeps that sync a baseline');

  const [again] = (await (await call(GET)).json()).proposals as PaperProposal[];
  assert.ok(!fields(again).includes('url'), 'a declined value is not offered again');
  assert.ok(fields(again).includes('pdf'));
});

test('POST refuses fields not in the recomputed proposal, a changed value, and unknown slugs', async () => {
  const stale = await call(POST, { body: { slug: SLUG, apply: ['doi'], decline: [] } });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /This paper changed; reload the review/);
  const otherValue = await call(POST, { body: { slug: SLUG, apply: [], decline: [{ field: 'url', value: 'x' }] } });
  assert.equal(otherValue.status, 409);
  assert.equal((await call(POST, { body: { slug: 'nope2026x', apply: ['arxiv'], decline: [] } })).status, 404);
  assert.equal((await call(POST, { body: { slug: SLUG, apply: ['topic'], decline: [] } })).status, 400);
  assert.equal(store.log.length, 0);
});
