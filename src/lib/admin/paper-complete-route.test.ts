import test, { after, afterEach, beforeEach, mock } from 'node:test';
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
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-'));
  const dir = path.join(root, 'src/content/publications');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'yazdanijahromi2026mirage.md'),
    `---\ntitle: '${MIRAGE}'\nauthors: ['M Yazdani-Jahromi', 'S Padhi', 'I Garibay']\nvenue: 'arXiv'\nyear: 2026\n` +
      `url: '${SCHOLAR_URL}'\ntype: 'preprint'\nfeatured: true\nimage: './mirage.png'\ntopic: 'drug-discovery'\n---\n\nOwner notes.\n`,
  );
  store = new MemoryStore(root);
  setStoreForTests(() => store);
  setPaperLookupForTests(arxivAnswers(FEED));
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

const FEED = fs.readFileSync(new URL('../../../tests/fixtures/papers/arxiv-mirage.xml', import.meta.url), 'utf8');

/** arXiv's title search answers `feed`; everything else 404s. */
const arxivAnswers = (feed: string): Lookup => ({
  async get(url) {
    if (url.startsWith('https://export.arxiv.org/api/query?search_query=')) return feed;
    throw new SourceError(`${url} answered 404`, 404);
  },
});

const SLUG = 'yazdanijahromi2026mirage';
const fields = (p: PaperProposal) => p.changes.map((c) => c.field);

/** The review as the owner saw it: GET's proposal, each field as { field, value, from }. */
async function reviewed(): Promise<Record<string, { field: string; value: unknown; from: unknown }>> {
  const [p] = (await (await call(GET)).json()).proposals as PaperProposal[];
  return Object.fromEntries(p.changes.map((c) => [c.field, { field: c.field, value: c.to, from: c.from }]));
}

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
  const seen = await reviewed();
  const res = await call(POST, {
    body: { slug: SLUG, apply: [seen.arxiv, seen.authors], decline: [{ field: 'url', value: seen.url.value }] },
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
  const seen = await reviewed();
  const stale = await call(POST, { body: { slug: SLUG, apply: [{ field: 'doi', value: '10.1/x' }], decline: [] } });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /This paper changed; reload the review/);
  const otherValue = await call(POST, { body: { slug: SLUG, apply: [], decline: [{ field: 'url', value: 'x' }] } });
  assert.equal(otherValue.status, 409);
  const otherApply = await call(POST, {
    body: { slug: SLUG, apply: [{ ...seen.arxiv, value: '9999.0001' }], decline: [] },
  });
  assert.equal(otherApply.status, 409, 'an applied value must be the one proposed');
  assert.equal((await call(POST, { body: { slug: 'nope2026x', apply: [seen.arxiv], decline: [] } })).status, 404);
  assert.equal((await call(POST, { body: { slug: SLUG, apply: ['arxiv'], decline: [] } })).status, 400, 'old shape');
  assert.equal((await call(POST, { body: { slug: SLUG, apply: [{ field: 'topic' }], decline: [] } })).status, 400);
  assert.equal(store.log.length, 0);
});

test('POST writes nothing when the source answers differently than the review showed', async () => {
  const seen = await reviewed();
  setPaperLookupForTests(arxivAnswers(FEED.replace('Sanjay Padhi', 'Sanjay K Padhi')));
  const res = await call(POST, { body: { slug: SLUG, apply: [seen.authors], decline: [] } });
  assert.equal(res.status, 409);
  assert.equal(store.log.length, 0);
});

test('POST writes nothing when the field was edited after the review', async () => {
  const seen = await reviewed();
  const file = (await store.read(`src/content/publications/${SLUG}.md`))!;
  const edited = file.content.replace(SCHOLAR_URL, 'https://example.org/mirage');
  await store.commit([{ path: file.path, content: edited }], 'owner edit', { [file.path]: file.version });
  const res = await call(POST, { body: { slug: SLUG, apply: [seen.url], decline: [] } });
  assert.equal(res.status, 409);
  assert.equal((await readEntry(store, 'publications', SLUG))!.data.url, 'https://example.org/mirage');
  assert.equal(store.log.length, 1, 'only the owner edit');
});

const PDF = Buffer.from('%PDF-1.7 mirage');
const PAPER = path.join('src/content/publications', `${SLUG}.md`);
const ABSTRACT = 'We introduce MIRAGE, a plug-in benchmark.';
const savedKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  mock.restoreAll();
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

/** Papers no source knows, each with `pdf` (the same uploaded file unless given); the model answers `reply`. */
function pdfPapers(slugs: string[], pdf = '/images/mirage-abc123.pdf', reply: unknown = { abstract: ABSTRACT }) {
  setPaperLookupForTests(arxivAnswers('<feed></feed>'));
  fs.mkdirSync(path.join(root, 'public/images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/images/mirage-abc123.pdf'), PDF);
  const md = fs.readFileSync(path.join(root, PAPER), 'utf8');
  fs.rmSync(path.join(root, PAPER));
  for (const slug of slugs)
    fs.writeFileSync(
      path.join(root, 'src/content/publications', `${slug}.md`),
      md.replace('---\n\n', `pdf: '${pdf}'\n---\n\n`),
    );
  process.env.ANTHROPIC_API_KEY = 'ak';
  const sent: Request[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init));
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return Response.json({ content: [{ type: 'text', text }] });
  });
  return sent;
}

/** Gives each paper its own PDF, so each needs a fresh reading. */
function ownPdfs(slugs: string[], tag: string) {
  for (const slug of slugs) {
    fs.writeFileSync(path.join(root, `public/images/${slug}-abc123.pdf`), Buffer.from(`%PDF-1.7 ${tag} ${slug}`));
    const md = path.join(root, 'src/content/publications', `${slug}.md`);
    fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace('mirage-abc123.pdf', `${slug}-abc123.pdf`));
  }
}

test('GET proposes from the uploaded PDF of a paper no source knows; POST applies it with no AI call', async () => {
  const sent = pdfPapers([SLUG]);
  const [p] = (await (await call(GET)).json()).proposals as PaperProposal[];
  assert.deepEqual(
    p.changes.map((c) => [c.field, c.to, c.source, c.fill]),
    [['abstract', ABSTRACT, 'pdf', true]],
  );
  assert.equal(p.noMatch, undefined);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
  const block = (await sent[0].json()).messages[0].content[0];
  assert.deepEqual(block.source, { type: 'base64', media_type: 'application/pdf', data: PDF.toString('base64') });

  const res = await call(POST, { body: { slug: SLUG, apply: [{ field: 'abstract', value: ABSTRACT }], decline: [] } });
  assert.equal(res.status, 200);
  assert.equal((await readEntry(store, 'publications', SLUG))!.data.abstract, ABSTRACT);
  assert.equal(sent.length, 1, 'the apply asks no AI');
});

test('POST takes a PDF field as reviewed, cleaned, without any AI call, and records a declined one', async () => {
  const sent = pdfPapers([SLUG]);
  ownPdfs([SLUG], 'never read');
  const res = await call(POST, {
    body: {
      slug: SLUG,
      apply: [{ field: 'abstract', value: `  We intro\u00adduce\n MIRAGE.${' x'.repeat(3000)}` }],
      decline: [{ field: 'title', value: ' MIRAGE:\u200b a benchmark ' }],
    },
  });
  assert.equal(res.status, 200);
  const abstract = (await readEntry(store, 'publications', SLUG))!.data.abstract as string;
  assert.ok(abstract.startsWith('We introduce MIRAGE. x x'), abstract.slice(0, 40));
  assert.equal(abstract.length, 5000, 'capped');
  const state = JSON.parse((await store.read(SCHOLAR_JSON))!.content);
  assert.deepEqual(state.declined[SLUG], { title: JSON.stringify('MIRAGE: a benchmark') });
  assert.equal(sent.length, 0, 'no AI call, empty cache and all');
});

test("POST refuses a PDF field on a paper whose pdf is not the site's own", async () => {
  const sent = pdfPapers([SLUG], 'https://example.org/mirage.pdf');
  const offSite = await call(POST, {
    body: { slug: SLUG, apply: [{ field: 'abstract', value: ABSTRACT }], decline: [] },
  });
  assert.equal(offSite.status, 409);
  assert.equal(store.log.length, 0);
  assert.equal(sent.length, 0);
});

test('POST refuses a PDF value that is unusable', async () => {
  const sent = pdfPapers([SLUG]);
  for (const bad of [
    { field: 'year', value: 'soon' },
    { field: 'authors', value: 'Jane Doe' },
    { field: 'title', value: ' ' },
  ]) {
    const res = await call(POST, { body: { slug: SLUG, apply: [], decline: [bad] } });
    assert.equal(res.status, 409, bad.field);
  }
  assert.equal(store.log.length, 0);
  assert.equal(sent.length, 0);
});

test('GET reads at most 5 PDFs a batch; the next paper starts the next batch', async () => {
  const slugs = ['a2026x', 'b2026x', 'c2026x', 'd2026x', 'e2026x', 'f2026x'];
  const sent = pdfPapers(slugs, '/images/mirage-abc123.pdf', { abstract: 'Budget.' });
  ownPdfs(slugs, 'budget');
  const first = await (await call(GET)).json();
  const read = (first.proposals as PaperProposal[]).map((p) => p.changes.some((c) => c.source === 'pdf'));
  assert.deepEqual([read, first.offset, sent.length], [[true, true, true, true, true], 5, 5]);
  const next = await (await call(GET, { query: '?offset=5' })).json();
  assert.deepEqual(
    (next.proposals as PaperProposal[]).map((p) => [p.slug, p.changes[0]?.source]),
    [['f2026x', 'pdf']],
  );
  assert.equal(sent.length, 6);
});

test('a reading already made costs no budget', async () => {
  const slugs = ['a2026x', 'b2026x', 'c2026x', 'd2026x', 'e2026x', 'f2026x', 'g2026x'];
  const sent = pdfPapers(slugs, '/images/mirage-abc123.pdf', { abstract: 'Shared.' });
  fs.writeFileSync(path.join(root, 'public/images/mirage-abc123.pdf'), Buffer.from('%PDF-1.7 shared'));
  const body = await (await call(GET)).json();
  assert.equal(body.offset, 7);
  assert.ok((body.proposals as PaperProposal[]).every((p) => p.changes[0]?.source === 'pdf'));
  assert.equal(sent.length, 1);
});

test("the uploaded PDF is never offered for replacement by a source's PDF link", async () => {
  pdfPapers([SLUG]);
  setPaperLookupForTests(arxivAnswers(FEED));
  const [p] = (await (await call(GET)).json()).proposals as PaperProposal[];
  assert.ok(fields(p).includes('arxiv'), 'arXiv matched');
  assert.ok(!fields(p).includes('pdf'), fields(p).join());
  const res = await call(POST, {
    body: {
      slug: SLUG,
      apply: [{ field: 'pdf', value: 'https://arxiv.org/pdf/2609.14491', from: '/images/mirage-abc123.pdf' }],
      decline: [],
    },
  });
  assert.equal(res.status, 409);
});

test('GET never reads a PDF off the site', async () => {
  const elsewhere = pdfPapers([SLUG], 'https://example.org/mirage.pdf');
  const [p] = (await (await call(GET)).json()).proposals as PaperProposal[];
  assert.equal(p.noMatch, true);
  assert.equal(elsewhere.length, 0, 'nothing fetched');
});

test("a reply that is not the JSON asked for is the paper's error, and nothing is offered", async () => {
  pdfPapers([SLUG], '/images/mirage-abc123.pdf', 'I cannot help with that.');
  fs.writeFileSync(path.join(root, 'public/images/mirage-abc123.pdf'), Buffer.from('%PDF-1.7 refused'));
  const [p] = (await (await call(GET)).json()).proposals as PaperProposal[];
  assert.deepEqual(p.changes, []);
  assert.match(p.error!, /Reading your PDF failed: .*JSON/);
});
