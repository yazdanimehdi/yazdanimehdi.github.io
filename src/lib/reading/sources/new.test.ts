import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseReadingPrefs } from '../settings';
import { fetchNew } from './new';

const fixture = (path: string) =>
  fs.readFileSync(new URL(`../../../../tests/fixtures/${path}`, import.meta.url), 'utf8');

/** A fake `get` answering by URL substring; records every URL asked for. */
function fake(routes: [string, (url: string) => string][]) {
  const urls: string[] = [];
  const get = async (url: string) => {
    urls.push(url);
    const hit = routes.find(([part]) => url.includes(part));
    if (!hit) throw new Error(`unexpected ${url}`);
    return hit[1](url);
  };
  return { urls, get };
}

const prefs = (sources: object) => parseReadingPrefs({ sources });

test('fetchNew arxiv drops replacements', async () => {
  const { urls, get } = fake([['rss.arxiv.org', () => fixture('reading/arxiv-rss.xml')]]);
  const papers = await fetchNew(
    'arxiv',
    prefs({ arxiv: { on: true, categories: ['cs.CL', 'cs.LG'] } }),
    get,
    '2026-10-22',
  );
  assert.deepEqual(urls, ['https://rss.arxiv.org/rss/cs.CL+cs.LG']);
  assert.deepEqual(
    papers.map((p) => p.key),
    ['arxiv:2610.28673', 'arxiv:2610.28710', 'arxiv:2610.26542'],
  );
  const [p] = papers;
  assert.equal(p.source, 'arxiv');
  assert.equal(p.arxiv, '2610.28673');
  assert.equal(p.url, 'https://arxiv.org/abs/2610.28673');
  assert.deepEqual(p.categories, ['cs.CL', 'cs.SD', 'eess.AS']);
  assert.ok((p.abstract ?? '').length > 100);
});

test('fetchNew biorxiv pages until the total', async () => {
  const one = JSON.parse(fixture('papers/biorxiv.json')).collection[0];
  const page = (cursor: number, n: number) =>
    JSON.stringify({
      messages: [{ status: 'ok', cursor, count: n, total: '45' }],
      collection: Array.from({ length: n }, (_, i) => ({ ...one, doi: `10.1101/${cursor + i}` })),
    });
  const { urls, get } = fake([
    ['/0?', () => page(0, 30)],
    ['/30?', () => page(30, 15)],
  ]);
  const papers = await fetchNew(
    'biorxiv',
    prefs({ biorxiv: { on: true, categories: ['neuroscience'] } }),
    get,
    '2026-10-22',
  );
  assert.deepEqual(urls, [
    'https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-22/0?category=neuroscience',
    'https://api.biorxiv.org/details/biorxiv/2026-10-20/2026-10-22/30?category=neuroscience',
  ]);
  assert.equal(papers.length, 45);
  assert.equal(papers[0].key, 'doi:10.1101/0');
  assert.equal(papers[0].url, 'https://doi.org/10.1101/0');
  assert.equal(papers[0].source, 'biorxiv');
  assert.deepEqual(papers[0].categories, ['neuroscience']);
});

test('fetchNew pubmed fetches the ids esearch found', async () => {
  const { urls, get } = fake([
    ['esearch.fcgi', () => fixture('reading/pubmed-esearch.json')],
    ['efetch.fcgi', () => fixture('papers/pubmed.xml')],
  ]);
  const papers = await fetchNew(
    'pubmed',
    prefs({ pubmed: { on: true, query: 'drug repurposing' } }),
    get,
    '2026-10-01',
  );
  assert.deepEqual(urls, [
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=200&datetype=edat&mindate=2026/09/29&maxdate=2026/10/01&term=drug%20repurposing',
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=37096593',
  ]);
  assert.equal(papers[0].key, 'doi:10.1093/bib/bbad136');
  assert.equal(papers[0].pmid, '37096593');
  assert.equal(papers[0].url, 'https://pubmed.ncbi.nlm.nih.gov/37096593/');
});

test('fetchNew pubmed skips efetch when esearch finds nothing', async () => {
  const { urls, get } = fake([['esearch.fcgi', () => JSON.stringify({ esearchresult: { count: '0', idlist: [] } })]]);
  assert.deepEqual(await fetchNew('pubmed', prefs({ pubmed: { on: true, query: 'x' } }), get, '2026-10-22'), []);
  assert.equal(urls.length, 1);
});

test('a source with no categories makes no request', async () => {
  const { urls, get } = fake([]);
  const on = prefs({
    arxiv: { on: true, categories: [] },
    biorxiv: { on: true, categories: [] },
    medrxiv: { on: true, categories: [] },
    pubmed: { on: true, query: ' ' },
  });
  for (const id of ['arxiv', 'biorxiv', 'medrxiv', 'pubmed'] as const)
    assert.deepEqual(await fetchNew(id, on, get, '2026-10-22'), []);
  assert.deepEqual(urls, []);
});
