import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setLookupForTests, SourceError } from '../career/sources/http';
import {
  completedFields,
  findPaper,
  fromPdf,
  fullAuthors,
  paperLookup,
  proposeFor,
  proposeBatch,
  proposeChanges,
  PROPOSE_FOR_MS,
  resetPacingForTests,
  sameAuthors,
  surnames,
  type Lookup,
  type PaperProposal,
  type ReadPdf,
} from './paper-complete';
import type { TextInput } from '../ai/providers';

const fixture = (name: string) =>
  fs.readFileSync(new URL(`../../../tests/fixtures/papers/${name}`, import.meta.url), 'utf8');

/** Answers the first route whose key prefixes the URL (a fixture name or a literal body); anything else 404s. */
function fake(routes: Record<string, string>): Lookup & { calls: [string, string?][] } {
  const calls: [string, string?][] = [];
  return {
    calls,
    async get(url, accept) {
      calls.push([url, accept]);
      const hit = Object.keys(routes).find((k) => url.startsWith(k));
      if (!hit) throw new SourceError(`${url} answered 404`, 404);
      const body = routes[hit];
      return /\.(xml|json|bib)$/.test(body) ? fixture(body) : body;
    },
  };
}

const crossrefItems = () => JSON.parse(fixture('crossref-search.json')).message.items;
const crossrefWork = JSON.stringify({ message: crossrefItems()[0] });

test('surnames fold the last word of each name; "Last, F." keeps the part before the comma', () => {
  assert.deepEqual(
    [...surnames(['M Yazdani-Jahromi', 'AK Yalabadi', '…', 'Penker, S.', 'José Núñez'])],
    ['yazdanijahromi', 'yalabadi', 'penker', 'nunez'],
  );
  assert.ok(sameAuthors(['O Garibay'], ['Ozlem Ozmen Garibay']));
  assert.ok(!sameAuthors([], ['Ozlem Ozmen Garibay']));
});

test('an arXiv id is looked up directly and completes MIRAGE', async () => {
  const look = fake({
    'https://export.arxiv.org/api/query?id_list=2609.14491': 'arxiv-mirage.xml',
    'https://api.crossref.org/works?': '{"message":{"items":[]}}',
  });
  const found = await findPaper({ title: 'x', authors: [], arxiv: '2609.14491' }, look);
  const { fields: f, sources } = await completedFields(found!, {}, look);
  assert.equal(f.url, 'https://arxiv.org/abs/2609.14491');
  assert.equal(f.pdf, 'https://arxiv.org/pdf/2609.14491');
  assert.equal(f.arxiv, '2609.14491');
  assert.equal((f.authors as string[]).length, 3);
  assert.equal(f.venue, 'arXiv');
  assert.equal(f.type, 'preprint');
  assert.match(String(f.bibtex), /^@misc\{/);
  assert.equal(sources.authors, 'arxiv');
  assert.equal(look.calls.filter(([u]) => u.startsWith('https://export.arxiv.org/')).length, 1);
});

test("MIRAGE completes from DataCite's arXiv records without arXiv's API, by id and by title", async () => {
  const byId = fake({
    'https://api.datacite.org/dois/10.48550/arXiv.2609.14491': 'datacite-mirage.json',
    'https://api.crossref.org/works?': '{"message":{"items":[]}}',
  });
  const found = await findPaper({ title: 'x', authors: ['M Yazdani-Jahromi'], arxiv: '2609.14491' }, byId);
  const { fields: f, sources } = await completedFields(found!, {}, byId);
  assert.equal(f.url, 'https://arxiv.org/abs/2609.14491');
  assert.equal(f.pdf, 'https://arxiv.org/pdf/2609.14491');
  assert.deepEqual(f.authors, ['Mehdi Yazdani-Jahromi', 'Sanjay Padhi', 'Ivan Garibay']);
  assert.equal(f.type, 'preprint');
  assert.match(String(f.bibtex), /^@misc\{[\s\S]*eprint = \{2609\.14491\}[\s\S]*primaryClass = \{q-bio\.QM\}/);
  assert.equal(sources.abstract, 'arxiv');

  const byTitle = fake({
    'https://api.datacite.org/dois?client-id=arxiv.content&page%5Bsize%5D=5&query=titles.title%3A%22Mirage%20measuring':
      'datacite-search.json',
    'https://api.crossref.org/works?': '{"message":{"items":[]}}',
  });
  const hit = await findPaper(
    {
      title: 'Mirage: measuring interpolation and redundancy in affinity generalization',
      authors: ['M Yazdani-Jahromi'],
    },
    byTitle,
  );
  assert.equal(hit?.arxiv?.arxiv, '2609.14491');
  for (const look of [byId, byTitle]) assert.ok(!look.calls.some(([u]) => u.includes('export.arxiv.org')));
});

test('an arXiv URL in url or pdf counts as its id', async () => {
  const look = fake({ 'https://export.arxiv.org/api/query?id_list=2609.14491': 'arxiv-mirage.xml' });
  const found = await findPaper({ title: 'x', authors: [], pdf: 'https://arxiv.org/pdf/2609.14491v2.pdf' }, look);
  assert.equal(found?.arxiv?.arxiv, '2609.14491');
});

const searched = (look: ReturnType<typeof fake>) =>
  look.calls.some(([u]) => u.startsWith('https://export.arxiv.org/api/query?search_query='));

test("a wrong arXiv id (another paper's authors) is dropped for a title search", async () => {
  const look = fake({ 'https://export.arxiv.org/api/query?id_list=2609.14491': 'arxiv-mirage.xml' });
  const found = await findPaper({ title: 'Another paper', authors: ['J Doe'], arxiv: '2609.14491' }, look);
  assert.equal(found, null);
  assert.ok(searched(look));
});

test("a wrong DOI (another paper's authors) is dropped for a title search", async () => {
  const look = fake({ 'https://api.crossref.org/works/10.52202': crossrefWork });
  const found = await findPaper({ title: 'Another paper', authors: ['J Doe'], doi: '10.52202/085713-0904' }, look);
  assert.equal(found, null);
  assert.ok(searched(look));
  assert.ok(!look.calls.some(([u]) => u.includes('085713-0904[doi]')), 'the dropped DOI is not searched on PubMed');
});

test("a right arXiv id is kept with Scholar's abbreviated authors, and its DOI gives the published version", async () => {
  const feed = fixture('arxiv-mirage.xml').replace(
    '</summary>',
    '</summary>\n    <arxiv:doi>10.52202/085713-0904</arxiv:doi>',
  );
  const look = fake({
    'https://export.arxiv.org/api/query?id_list=2609.14491': feed,
    'https://api.crossref.org/works/10.52202/085713-0904': crossrefWork,
  });
  const found = await findPaper({ title: 'Mirage', authors: ['M Yazdani-Jahromi'], arxiv: '2609.14491' }, look);
  assert.equal(found?.arxiv?.arxiv, '2609.14491');
  assert.equal(found?.crossref?.doi, '10.52202/085713-0904');
  assert.ok(!searched(look));
});

test("a title search matches Scholar's abbreviated, truncated authors and other casing", async () => {
  const look = fake({
    'https://export.arxiv.org/api/query?search_query=': 'arxiv-mirage.xml',
    'https://api.crossref.org/works?': '{"message":{"items":[]}}',
  });
  const found = await findPaper(
    {
      title: 'Mirage: measuring interpolation and redundancy in affinity generalization',
      authors: ['M Yazdani-Jahromi', 'AK Yalabadi', '…'],
    },
    look,
  );
  assert.equal(found?.arxiv?.arxiv, '2609.14491');
});

test('the same title by other people is not a match', async () => {
  const look = fake({
    'https://export.arxiv.org/api/query?search_query=': 'arxiv-mirage.xml',
    'https://api.crossref.org/works?': '{"message":{"items":[]}}',
  });
  assert.equal(
    await findPaper(
      { title: 'MIRAGE: Measuring Interpolation and Redundancy in Affinity GEneralization', authors: ['J Doe'] },
      look,
    ),
    null,
  );
});

test('a published conference venue is never downgraded to arXiv', async () => {
  const look = fake({
    'https://export.arxiv.org/api/query?id_list=': 'arxiv-mirage.xml',
    'https://api.crossref.org/works?': '{"message":{"items":[]}}',
  });
  const found = await findPaper({ title: 'x', authors: [], arxiv: '2609.14491' }, look);
  const { fields: f } = await completedFields(
    found!,
    { venue: 'Advances in Neural Information Processing Systems', type: 'conference' },
    look,
  );
  assert.equal(f.venue, undefined);
  assert.equal(f.type, undefined);
});

test('a DOI gives the published venue and the publisher BibTeX', async () => {
  const look = fake({
    'https://api.crossref.org/works/10.52202': crossrefWork,
    'https://doi.org/10.52202/085713-0904': 'doi.bib',
  });
  const found = await findPaper({ title: 'x', authors: [], doi: '10.52202/085713-0904' }, look);
  const { fields: f, sources } = await completedFields(found!, {}, look);
  assert.ok(f.venue && f.type !== 'preprint');
  assert.equal(String(f.bibtex).trim(), fixture('doi.bib').trim());
  assert.equal(f.url, 'https://doi.org/10.52202/085713-0904');
  assert.equal(sources.venue, 'crossref');
  assert.deepEqual(
    look.calls.find(([u]) => u.startsWith('https://doi.org/')),
    ['https://doi.org/10.52202/085713-0904', 'application/x-bibtex'],
  );
});

test('a PubMed-only paper gets its abstract and full authors from PubMed', async () => {
  const look = fake({
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?': '{"esearchresult":{"idlist":["37078687"]}}',
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?': 'pubmed.xml',
  });
  const found = await findPaper(
    {
      title:
        'BindingSite-AugmentedDTA: enabling a next-generation pipeline for interpretable prediction models in drug repurposing',
      authors: ['N Yousefi', 'M Yazdani-Jahromi', '…'],
    },
    look,
  );
  assert.ok(found?.pubmed);
  assert.match(look.calls.find(([u]) => u.includes('esearch'))![0], /tool=ScholarOS.*%5Btitle%5D/);
  const { fields: f, sources } = await completedFields(found!, {}, look);
  assert.equal((f.authors as string[]).length, 10);
  assert.ok(String(f.abstract).length > 200);
  assert.equal(sources.abstract, 'pubmed');
  assert.equal(f.type, 'journal');
  assert.equal(f.doi, '10.1093/bib/bbad136');
  assert.match(String(f.bibtex), /^@article\{yousefi\d{4}bindingsite,/);
});

test('an OpenAlex-only conference paper gets venue and abstract', async () => {
  const [w] = JSON.parse(fixture('openalex.json')).results;
  const work = {
    ...w,
    doi: null,
    type: 'article',
    primary_location: {
      source: { display_name: 'International Conference on Learning Representations', type: 'conference' },
    },
  };
  const look = fake({ 'https://api.openalex.org/works?search=': JSON.stringify({ results: [work] }) });
  const found = await findPaper(
    { title: 'HELM: hierarchical encoding for mRNA language modeling', authors: ['M Yazdani-Jahromi', 'R Liao'] },
    look,
  );
  const { fields: f, sources } = await completedFields(found!, {}, look);
  assert.equal(f.venue, 'International Conference on Learning Representations');
  assert.equal(f.type, 'conference');
  assert.ok(String(f.abstract).length > 100);
  assert.equal(sources.abstract, 'openalex');
  assert.equal(f.pdf, w.best_oa_location.pdf_url);
  assert.match(String(f.bibtex), /^@inproceedings\{.*booktitle = \{International Conference/s);
});

test('an OpenAlex work in a repository (Zenodo) is no proof of publication', async () => {
  const [w] = JSON.parse(fixture('openalex.json')).results;
  const work = {
    ...w,
    doi: null,
    type: 'article',
    primary_location: { source: { display_name: 'Zenodo', type: 'repository' } },
  };
  const look = fake({ 'https://api.openalex.org/works?search=': JSON.stringify({ results: [work] }) });
  const found = await findPaper(
    { title: 'HELM: hierarchical encoding for mRNA language modeling', authors: ['M Yazdani-Jahromi'] },
    look,
  );
  const { fields: f, sources } = await completedFields(found!, {}, look);
  assert.equal(sources.abstract, 'openalex');
  assert.equal(f.venue, undefined);
  assert.equal(f.type, undefined);
});

test('a bioRxiv DOI completes from bioRxiv, and its published DOI gives the venue', async () => {
  const published = {
    message: {
      DOI: '10.1523/JNEUROSCI.2420-23.2024',
      title: [
        'Synaptic connectivity and electrophysiological properties of the nucleus of the lateral olfactory tract',
      ],
      author: [{ given: 'Shani', family: 'Penker' }],
      issued: { 'date-parts': [[2024, 5]] },
      'container-title': ['The Journal of Neuroscience'],
      type: 'journal-article',
    },
  };
  const look = fake({
    'https://api.biorxiv.org/details/biorxiv/10.1101/2023.12.31.573522': 'biorxiv.json',
    'https://api.crossref.org/works/10.1523/JNEUROSCI.2420-23.2024': JSON.stringify(published),
  });
  const found = await findPaper({ title: 'x', authors: [], doi: '10.1101/2023.12.31.573522' }, look);
  const { fields: f, sources } = await completedFields(found!, {}, look);
  assert.equal(sources.title, 'biorxiv');
  assert.equal(sources.abstract, 'biorxiv');
  assert.equal((f.authors as string[])[0], 'Penker, S.');
  assert.equal(f.venue, 'The Journal of Neuroscience');
  assert.equal(f.type, 'journal');
  assert.equal(f.year, 2024);
  assert.equal(f.doi, '10.1523/JNEUROSCI.2420-23.2024');
});

test('a bioRxiv-only preprint keeps venue bioRxiv', async () => {
  const json = JSON.parse(fixture('biorxiv.json'));
  for (const c of json.collection) c.published = 'NA';
  const look = fake({ 'https://api.biorxiv.org/details/biorxiv/': JSON.stringify(json) });
  const found = await findPaper({ title: 'x', authors: [], doi: '10.1101/2023.12.31.573522' }, look);
  const { fields: f } = await completedFields(found!, {}, look);
  assert.equal(f.venue, 'bioRxiv');
  assert.equal(f.type, 'preprint');
  assert.equal(f.url, 'https://doi.org/10.1101/2023.12.31.573522');
});

test('a PubMed DOI search that returns another paper is not used', async () => {
  const look = fake({
    'https://api.crossref.org/works/10.52202': crossrefWork,
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?': '{"esearchresult":{"idlist":["37078687"]}}',
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?': 'pubmed.xml',
  });
  const found = await findPaper({ title: 'x', authors: [], doi: '10.52202/085713-0904' }, look);
  assert.ok(look.calls.some(([u]) => u.includes('efetch')));
  assert.equal(found?.pubmed, undefined);
});

test('a DOI that PubMed found and Crossref never returned is looked up on Crossref', async () => {
  const work = { ...crossrefItems()[0], DOI: '10.1093/bib/bbad136', type: 'proceedings-article' };
  const look = fake({
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?': '{"esearchresult":{"idlist":["37078687"]}}',
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?': 'pubmed.xml',
    'https://api.crossref.org/works/10.1093/bib/bbad136': JSON.stringify({ message: work }),
  });
  const found = await findPaper(
    {
      title:
        'BindingSite-AugmentedDTA: enabling a next-generation pipeline for interpretable prediction models in drug repurposing',
      authors: ['M Yazdani-Jahromi'],
    },
    look,
  );
  const { fields: f, sources } = await completedFields(found!, {}, look);
  assert.equal(sources.type, 'crossref');
  assert.equal(f.type, 'conference');
});

test('DOIs are encoded in URL paths, and anything not starting 10. is not a DOI', async () => {
  const look = fake({});
  await findPaper({ title: 'x', authors: ['A B'], doi: '10.1000/a#b?c' }, look);
  assert.ok(look.calls.some(([u]) => u === 'https://api.crossref.org/works/10.1000/a%23b%3Fc'));
  assert.ok(look.calls.some(([u]) => u === 'https://api.openalex.org/works/doi:10.1000/a%23b%3Fc'));
  const other = fake({});
  await findPaper({ title: 'x', authors: ['A B'], doi: 'not-a-doi' }, other);
  assert.ok(!other.calls.some(([u]) => u.includes('not-a-doi')));
});

/** paperLookup over the real safe fetch, with fetch faked and time kept by the fake sleep. */
function realLookup(answers: (url: string) => Response) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const waits: number[] = [];
  let t = 1_000_000;
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    urls.push(String(input));
    headers.push(init?.headers as Record<string, string>);
    return answers(String(input));
  });
  const look = paperLookup({
    siteUrl: 'https://site.test',
    email: 'me@site.test',
    sleep: async (ms) => {
      waits.push(ms);
      t += ms;
    },
    now: () => t,
  });
  return { look, urls, headers, waits };
}

test.beforeEach(() => {
  resetPacingForTests();
  setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);
});
test.afterEach(() => {
  mock.restoreAll();
  setLookupForTests(null);
});

test('paperLookup keeps 3 s between arXiv calls and names the site with a mailto', async () => {
  const { look, headers, waits, urls } = realLookup(() => new Response('ok'));
  await look.get('https://export.arxiv.org/api/query?id_list=1');
  await look.get('https://api.crossref.org/works/10.1/x');
  await look.get('https://export.arxiv.org/api/query?id_list=2');
  assert.deepEqual(waits, [3000]);
  assert.equal(headers[0]['User-Agent'], 'ScholarOS paper import (+https://site.test; mailto:me@site.test)');
  assert.equal(headers[0].Accept, 'application/json, application/atom+xml');
  await look.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed');
  await look.get('https://api.openalex.org/works?search=x');
  assert.match(urls[3], /&email=me%40site\.test$/);
  assert.match(urls[4], /&mailto=me%40site\.test$/);
});

test('paperLookup keeps the arXiv gap across instances', async () => {
  const one = realLookup(() => new Response('ok'));
  await one.look.get('https://export.arxiv.org/api/query?id_list=1');
  const two = paperLookup({
    siteUrl: 'https://site.test',
    sleep: async (ms) => void one.waits.push(ms),
    now: () => 1_000_000,
  });
  await two.get('https://export.arxiv.org/api/query?id_list=2');
  assert.deepEqual(one.waits, [3000]);
});

test('paperLookup paces concurrent arXiv calls too', async () => {
  const { look, waits } = realLookup(() => new Response('ok'));
  await Promise.all([1, 2, 3].map((i) => look.get(`https://export.arxiv.org/api/query?id_list=${i}`)));
  assert.deepEqual(waits, [3000, 3000]);
});

test('paperLookup retries arXiv 503/429 twice, honouring Retry-After, then gives up', async () => {
  let n = 0;
  const busy = realLookup(() =>
    ++n === 1 ? new Response('', { status: 503, headers: { 'Retry-After': '7' } }) : new Response('', { status: 429 }),
  );
  await assert.rejects(busy.look.get('https://export.arxiv.org/api/query?id_list=1'), { status: 429 });
  assert.equal(busy.urls.length, 3);
  assert.deepEqual(busy.waits, [7000, 5000]);
  mock.restoreAll();
  resetPacingForTests();

  let m = 0;
  const flaky = realLookup(() => (++m === 1 ? new Response('', { status: 503 }) : new Response('feed')));
  assert.equal(await flaky.look.get('https://export.arxiv.org/api/query?id_list=1'), 'feed');
  assert.deepEqual(flaky.waits, [5000]);
});

test('paperLookup does not retry other sources', async () => {
  const { look, urls } = realLookup(() => new Response('', { status: 503 }));
  await assert.rejects(look.get('https://api.crossref.org/works/10.1/x'), { status: 503 });
  assert.equal(urls.length, 1);
});

test('proposeChanges: fills, replacements, whitespace-only titles and declines', () => {
  const current = {
    title: 'Mirage:  measuring interpolation',
    authors: ['M Yazdani-Jahromi'],
    url: 'https://scholar.google.com/x',
  };
  const completed = {
    title: 'Mirage: measuring interpolation',
    authors: ['Mehdi Yazdani-Jahromi', 'A B', 'C D'],
    url: 'https://arxiv.org/abs/2609.14491',
    arxiv: '2609.14491',
  };
  const ch = proposeChanges(current, completed);
  assert.deepEqual(
    ch.map((c) => [c.field, c.fill]),
    [
      ['authors', false],
      ['arxiv', true],
      ['url', false],
    ],
  );
  const again = proposeChanges(current, completed, { url: JSON.stringify('https://arxiv.org/abs/2609.14491') });
  assert.deepEqual(
    again.map((c) => c.field),
    ['authors', 'arxiv'],
  );
  const newer = proposeChanges(
    current,
    { ...completed, url: 'https://arxiv.org/abs/2609.14491v2' },
    { url: JSON.stringify('https://arxiv.org/abs/2609.14491') },
  );
  assert.ok(
    newer.some((c) => c.field === 'url'),
    'a different value is offered again',
  );
  assert.deepEqual(proposeChanges({ authors: ['A B'], year: 2026 }, { authors: ['A B'], year: 2026 }), [], 'equal');
  const sourced = proposeChanges({}, { arxiv: '1' }, {}, { arxiv: 'arxiv' });
  assert.deepEqual(sourced, [{ field: 'arxiv', from: undefined, to: '1', fill: true, source: 'arxiv' }]);
});

test('proposeBatch: one paper at least, none started after PROPOSE_FOR_MS, and it stops at a source failure', async () => {
  const entries = ['a', 'b', 'c'].map((slug) => ({ slug, data: { title: `Paper ${slug}`, authors: ['J Smith'] } }));
  let t = 0;
  const slow: Lookup = {
    async get() {
      t += PROPOSE_FOR_MS; // each paper's lookups use up the whole budget
      throw new SourceError('nothing here', 404);
    },
  };
  const timed = await proposeBatch(entries, slow, {}, undefined, () => t);
  assert.deepEqual(
    timed.map((p) => [p.slug, p.noMatch]),
    [['a', true]],
  );

  const down: Lookup = {
    async get() {
      throw new SourceError('arXiv answered 503', 503);
    },
  };
  const failed = await proposeBatch(entries, down, {});
  assert.deepEqual(
    failed.map((p) => [p.slug, p.error]),
    [['a', 'arXiv answered 503']],
  );

  const broken: ReadPdf = async () => {
    throw new Error('The AI did not answer with JSON');
  };
  const withPdf = entries.map((e) => ({ ...e, data: { ...e.data, pdf: `/images/${e.slug}.pdf` } }));
  const unreadable = await proposeBatch(withPdf, NOWHERE, {}, broken);
  assert.deepEqual(
    unreadable.map((p) => p.slug),
    ['a', 'b', 'c'],
    "an unreadable PDF is that paper's error, not the batch's end",
  );
  assert.ok(unreadable.every((p) => /your PDF/.test(p.error!)));
});

const MIRAGE = 'MIRAGE: Measuring Interpolation and Redundancy in Affinity GEneralization';
const FULL = ['Mehdi Yazdani-Jahromi', 'Sanjay Padhi', 'Ivan Garibay'];
const FROM_PDF = { source: 'pdf' as const, title: MIRAGE, authors: FULL, abstract: 'We introduce MIRAGE.', year: 2026 };
const NOWHERE: Lookup = {
  async get(url) {
    throw new SourceError(`${url} answered 404`, 404);
  },
};
/** Answers every read with `record` and records the URLs read. */
const reader = (record: Awaited<ReturnType<ReadPdf>> = FROM_PDF): ReadPdf & { urls: string[] } => {
  const urls: string[] = [];
  return Object.assign(async (url: string) => (urls.push(url), record), { urls });
};
const byField = (p: PaperProposal) => Object.fromEntries(p.changes.map((c) => [c.field, c]));

test('fullAuthors: every name needs a first name, not only initials', () => {
  assert.ok(fullAuthors(['Mehdi Yazdani-Jahromi', 'Ozlem Ozmen Garibay', 'Núñez, José']));
  for (const a of [['M Yazdani-Jahromi'], ['Mehdi Yazdani', 'AK Yalabadi'], ['Penker, S.'], ['Garibay'], [], undefined])
    assert.ok(!fullAuthors(a), String(a));
});

test('fromPdf: the model reads the attached PDF; its JSON is a pdf-sourced record with cleaned strings', async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  let sent: TextInput | undefined;
  const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
    title: ` ${MIRAGE}\u200b `,
    authors: ['Mehdi\u2028Yazdani-Jahromi', ' ', 'Sanjay Padhi', 7],
    abstract: 'We intro\u00adduce MIRAGE.',
    year: 2026,
  })}\n\`\`\``;
  const record = await fromPdf(bytes, async (input) => ((sent = input), reply));
  assert.deepEqual(record, {
    source: 'pdf',
    title: MIRAGE,
    authors: ['Mehdi Yazdani-Jahromi', 'Sanjay Padhi'],
    abstract: 'We introduce MIRAGE.',
    year: 2026,
  });
  assert.equal(sent!.pdf!.bytes, bytes);
  assert.match(sent!.system, /JSON/);

  await assert.rejects(
    fromPdf(bytes, async () => 'Sorry, I cannot read that file.'),
    /JSON/,
  );
  assert.equal(await fromPdf(bytes, async () => '{"title":" ","authors":[],"abstract":""}'), null, 'nothing usable');
  assert.equal((await fromPdf(bytes, async () => '{"title":"T","year":"soon"}'))?.year, 0, 'no year');
  assert.equal((await fromPdf(bytes, async () => '{"title":"T","year":3026}'))?.year, 0, 'no future year');
  const long = await fromPdf(bytes, async () => JSON.stringify({ title: 't'.repeat(600), abstract: 'a'.repeat(6000) }));
  assert.deepEqual([long?.title.length, long?.abstract?.length], [500, 5000], 'capped');
});

test('proposeFor: a paper no source knows is proposed from its uploaded PDF, every change marked pdf', async () => {
  const data = { title: 'Mirage', authors: ['M Yazdani-Jahromi'], year: 2026, pdf: '/images/mirage-abc123.pdf' };
  const read = reader();
  const p = await proposeFor('m', data, NOWHERE, {}, read);
  assert.deepEqual(read.urls, ['/images/mirage-abc123.pdf']);
  assert.equal(p.noMatch, undefined);
  assert.deepEqual(
    p.changes.map((c) => [c.field, c.source, c.fill]),
    [
      ['title', 'pdf', false],
      ['authors', 'pdf', false],
      ['abstract', 'pdf', true],
    ],
    'year is unchanged, so not offered',
  );
  assert.equal(byField(p).abstract.to, 'We introduce MIRAGE.');

  const declined = await proposeFor('m', data, NOWHERE, { abstract: JSON.stringify('We introduce MIRAGE.') }, reader());
  assert.ok(!byField(declined).abstract, 'a declined PDF value is not offered again');

  const none = await proposeFor('m', { ...data, pdf: undefined }, NOWHERE, {}, read);
  assert.equal(none.noMatch, true);
  assert.equal(read.urls.length, 1, 'no pdf, no read');
  assert.equal((await proposeFor('m', data, NOWHERE, {}, reader(null))).noMatch, true, 'not an own PDF');
  assert.equal((await proposeFor('m', data, NOWHERE)).noMatch, true, 'no reader');
});

test('proposeFor: a PDF the model fails on is the error only when nothing else was found', async () => {
  const data = { title: 'Mirage', authors: ['M Yazdani-Jahromi'], pdf: '/images/mirage-abc123.pdf' };
  const broken: ReadPdf = async () => {
    throw new Error('The AI did not answer with JSON');
  };
  const alone = await proposeFor('m', data, NOWHERE, {}, broken);
  assert.deepEqual([alone.changes, alone.noMatch], [[], undefined]);
  assert.match(alone.error!, /your PDF.*did not answer with JSON/i);

  const feed = fixture('arxiv-mirage.xml').replace(/<summary>[\s\S]*?<\/summary>/, '');
  const look = fake({ 'https://export.arxiv.org/api/query?id_list=2609.14491': feed });
  const matched = await proposeFor('m', { ...data, arxiv: '2609.14491' }, look, {}, broken);
  assert.equal(matched.error, undefined);
  assert.ok(byField(matched).bibtex, "the sources' changes stand");
});

test('proposeFor: a matched paper reads its PDF only for a missing abstract or initials-only authors', async () => {
  const data = { title: MIRAGE, authors: ['M Yazdani-Jahromi'], arxiv: '2609.14491', pdf: '/images/mirage-abc123.pdf' };
  const complete = fake({ 'https://export.arxiv.org/api/query?id_list=2609.14491': 'arxiv-mirage.xml' });
  const read = reader();
  const p = await proposeFor('m', data, complete, {}, read);
  assert.equal(read.urls.length, 0, 'arXiv has the abstract and full authors');
  assert.equal(byField(p).authors.source, 'arxiv');

  const thin = fixture('arxiv-mirage.xml')
    .replace(/<summary>[\s\S]*?<\/summary>/, '')
    .replace(/<name>(\S)\S* /g, '<name>$1 ');
  const look = fake({ 'https://export.arxiv.org/api/query?id_list=2609.14491': thin });
  const q = await proposeFor('m', data, look, {}, read);
  assert.equal(read.urls.length, 1);
  const by = byField(q);
  assert.deepEqual([by.abstract.source, by.authors.source, by.authors.to], ['pdf', 'pdf', FULL]);
  assert.equal(by.bibtex.source, 'arxiv');
  assert.deepEqual(
    p.changes
      .concat(q.changes)
      .filter((c) => c.source === 'pdf')
      .map((c) => c.field),
    ['authors', 'abstract'],
    "a matched paper takes only the missing fields from its PDF; its year stays arXiv's",
  );
  assert.equal(by.year.source, 'arxiv');
});
