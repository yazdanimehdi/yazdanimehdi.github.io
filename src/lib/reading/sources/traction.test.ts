import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseReadingPrefs } from '../settings';
import {
  blueskyCount,
  fetchTraction,
  parseAlphaxiv,
  parseHfDaily,
  parseOpenAlexTraction,
  searchTopics,
} from './traction';

const fixture = (path: string) =>
  fs.readFileSync(new URL(`../../../../tests/fixtures/${path}`, import.meta.url), 'utf8');
const json = (path: string) => JSON.parse(fixture(path));

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

test('parseHfDaily reads the arXiv id, upvotes and comments', () => {
  const papers = parseHfDaily(json('reading/hf-daily.json'));
  assert.deepEqual(
    papers.map((p) => p.key),
    ['arxiv:2610.14224', 'arxiv:2508.02739', 'arxiv:2610.23374'],
  );
  const [p, noDaily] = papers;
  assert.equal(p.source, 'huggingface');
  assert.equal(p.arxiv, '2610.14224');
  assert.equal(p.url, 'https://arxiv.org/abs/2610.14224');
  assert.deepEqual(p.authors, ['Ruiyao Xu', 'Yanfei Chen', 'Zhongying CuiZhu']);
  assert.ok((p.abstract ?? '').length > 100);
  assert.equal(p.publishedAt, '2026-10-09');
  assert.deepEqual(p.signals, { huggingface: { upvotes: 116, comments: 2, since: '2026-10-14T00:00:00.000Z' } });
  // Never submitted to the daily list: counted since the paper's own date.
  assert.equal(noDaily.signals?.huggingface?.since, '2025-08-02T13:15:59.000Z');
  assert.deepEqual(parseHfDaily({ error: 'junk' }), []);
});

test('parseOpenAlexTraction keeps citations and the publication date', () => {
  const papers = parseOpenAlexTraction(json('reading/openalex-works.json'));
  assert.equal(papers.length, 3);
  const [p] = papers;
  assert.equal(p.key, 'doi:10.5281/zenodo.23236017');
  assert.equal(p.source, 'openalex');
  assert.equal(p.url, 'https://doi.org/10.5281/zenodo.23236017');
  assert.equal(p.publishedAt, '2026-10-08');
  assert.deepEqual(p.signals, { openalex: { citations: 463, since: '2026-10-08' } });
  assert.ok((p.abstract ?? '').length > 100);
  assert.deepEqual(parseOpenAlexTraction('junk'), []);
});

test('parseOpenAlexTraction maps an arXiv DOI to the arXiv key', () => {
  const p = parseOpenAlexTraction(json('reading/openalex-works.json'))[1];
  assert.equal(p.key, 'arxiv:2610.14004');
  assert.equal(p.arxiv, '2610.14004');
  assert.equal(p.url, 'https://arxiv.org/abs/2610.14004');
  assert.deepEqual(p.signals, { openalex: { citations: 71, since: '2026-09-27' } });
});

test('parseAlphaxiv reads 7-day visits', () => {
  const papers = parseAlphaxiv(json('reading/alphaxiv-feed.json'));
  assert.deepEqual(
    papers.map((p) => p.key),
    ['arxiv:2610.28480', 'arxiv:2610.30136', 'arxiv:2610.28594'],
  );
  const [p] = papers;
  assert.equal(p.source, 'alphaxiv');
  assert.equal(p.url, 'https://arxiv.org/abs/2610.28480');
  assert.equal(p.authors[0], 'Qiayuan Liao');
  assert.equal(p.publishedAt, '2026-10-20');
  assert.ok((p.abstract ?? '').length > 100);
  assert.deepEqual(p.signals, { alphaxiv: { visits: 1617, votes: 105 } });
  assert.deepEqual(parseAlphaxiv({ papers: 'junk' }), []);
});

const openalexPrefs = (topics: { id: string; name: string }[]) =>
  parseReadingPrefs({ sources: { openalex: { on: true, topics } } });
const works = () => fixture('reading/openalex-works.json');
const SELECT =
  'select=id,doi,display_name,authorships,publication_year,publication_date,cited_by_count,abstract_inverted_index,primary_location,best_oa_location,type';

test('fetchTraction openalex adds api_key only when given', async () => {
  const prefs = openalexPrefs([{ id: 'subfields/1702', name: 'Artificial Intelligence' }]);
  const url = `https://api.openalex.org/works?filter=primary_topic.subfield.id:1702,from_publication_date:2026-08-23&sort=cited_by_count:desc&per_page=50&${SELECT}`;
  const without = fake([['api.openalex.org/works', works]]);
  const papers = await fetchTraction('openalex', prefs, without.get, '2026-10-22');
  assert.deepEqual(without.urls, [url]);
  assert.equal(papers.length, 3);
  const withKey = fake([['api.openalex.org/works', works]]);
  await fetchTraction('openalex', prefs, withKey.get, '2026-10-22', 'k3y');
  assert.deepEqual(withKey.urls, [`${url}&api_key=k3y`]);
});

test('fetchTraction openalex queries fields and subfields separately', async () => {
  const prefs = openalexPrefs([
    { id: 'fields/17', name: 'Computer Science' },
    { id: 'subfields/1702', name: 'Artificial Intelligence' },
    { id: 'subfields/2805', name: 'Cognitive Neuroscience' },
  ]);
  const { urls, get } = fake([['api.openalex.org/works', works]]);
  const papers = await fetchTraction('openalex', prefs, get, '2026-10-22');
  assert.deepEqual(
    urls.map((u) => new URL(u).searchParams.get('filter')),
    [
      'primary_topic.field.id:17,from_publication_date:2026-08-23',
      'primary_topic.subfield.id:1702|2805,from_publication_date:2026-08-23',
    ],
  );
  // The same works from both requests: one paper per key.
  assert.equal(papers.length, 3);
  const none = fake([]);
  assert.deepEqual(await fetchTraction('openalex', openalexPrefs([]), none.get, '2026-10-22'), []);
  assert.deepEqual(none.urls, []);
});

test('fetchTraction asks Hugging Face and alphaXiv for their trending lists', async () => {
  const { urls, get } = fake([
    ['huggingface.co', () => fixture('reading/hf-daily.json')],
    ['alphaxiv.org', () => fixture('reading/alphaxiv-feed.json')],
  ]);
  const prefs = parseReadingPrefs({});
  assert.equal((await fetchTraction('huggingface', prefs, get, '2026-10-22')).length, 3);
  assert.equal((await fetchTraction('alphaxiv', prefs, get, '2026-10-22')).length, 3);
  assert.deepEqual(urls, [
    'https://huggingface.co/api/daily_papers?sort=trending&limit=50',
    'https://api.alphaxiv.org/papers/v3/feed?pageNum=0&pageSize=50&sort=Hot&interval=7%20Days',
  ]);
});

test('blueskyCount marks a full page as capped', async () => {
  const some = fake([['searchPosts', () => fixture('reading/bsky-search.json')]]);
  assert.deepEqual(await blueskyCount(some.get, { arxiv: '2610.14224', doi: '10.1/x' }, '2026-10-22'), {
    posts: 3,
    capped: false,
  });
  assert.deepEqual(some.urls, [
    'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=arxiv.org%2Fabs%2F2610.14224&limit=100&since=2026-08-23T00:00:00Z',
  ]);
  const post = json('reading/bsky-search.json').posts[0];
  const full = fake([['searchPosts', () => JSON.stringify({ posts: Array(100).fill(post) })]]);
  assert.deepEqual(await blueskyCount(full.get, { arxiv: null, doi: '10.1145/3845797' }, '2026-10-22'), {
    posts: 100,
    capped: true,
  });
  assert.equal(new URL(full.urls[0]).searchParams.get('q'), '10.1145/3845797');
  const none = fake([]);
  assert.equal(await blueskyCount(none.get, { arxiv: null, doi: null }, '2026-10-22'), null);
  assert.deepEqual(none.urls, []);
});

test('searchTopics lists fields before subfields', async () => {
  const { urls, get } = fake([
    [
      '/fields?',
      () => JSON.stringify({ results: [{ id: 'https://openalex.org/fields/17', display_name: 'Computer Science' }] }),
    ],
    ['/subfields?', () => fixture('reading/openalex-subfields.json')],
  ]);
  assert.deepEqual(await searchTopics(get, 'computer'), [
    { id: 'fields/17', name: 'Computer Science', level: 'field' },
    { id: 'subfields/1707', name: 'Computer Vision and Pattern Recognition', level: 'subfield' },
    { id: 'subfields/1705', name: 'Computer Networks and Communications', level: 'subfield' },
    { id: 'subfields/1709', name: 'Human-Computer Interaction', level: 'subfield' },
  ]);
  assert.deepEqual(urls, [
    'https://api.openalex.org/fields?search=computer&select=id,display_name',
    'https://api.openalex.org/subfields?search=computer&select=id,display_name',
  ]);
  const eight = (level: string) =>
    JSON.stringify({ results: Array(8).fill({ id: `https://openalex.org/${level}/1`, display_name: 'X' }) });
  const keyed = fake([
    ['/fields?', () => eight('fields')],
    ['/subfields?', () => eight('subfields')],
  ]);
  assert.equal((await searchTopics(keyed.get, 'neuro science', 'k3y')).length, 10);
  assert.equal(
    keyed.urls[0],
    'https://api.openalex.org/fields?search=neuro%20science&select=id,display_name&api_key=k3y',
  );
});
