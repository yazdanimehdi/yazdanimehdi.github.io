import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setLookupForTests, SourceError } from '../career/sources/http';
import {
  completedFields,
  findPaper,
  paperLookup,
  resetPacingForTests,
  sameAuthors,
  surnames,
  type Lookup,
} from './paper-complete';

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

test('an arXiv URL in url or pdf counts as its id', async () => {
  const look = fake({ 'https://export.arxiv.org/api/query?id_list=2609.14491': 'arxiv-mirage.xml' });
  const found = await findPaper({ title: 'x', authors: [], pdf: 'https://arxiv.org/pdf/2609.14491v2.pdf' }, look);
  assert.equal(found?.arxiv?.arxiv, '2609.14491');
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
