import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { setStoreForTests } from '../admin/get-store';
import { HttpError } from '../admin/http';
import { PostgresStore } from '../admin/postgres-store';
import { setLookupForTests } from '../career/sources/http';
import { ensureTexts } from '../../workflows/texts';
import { missingTexts, saveText, upsertPapers } from './db';
import { fetchArxivText, storeUpload, textNeedFor } from './fetch-text';
import { getPassages, readText } from './room-db';
import { minimalPdf } from './test-pdf';
import type { NewPaper } from './types';

let sql: Sql;
let arxiv: Record<string, () => Response | Promise<Response>>;
let fetched: string[];
let agents: string[];
let sleeps: unknown[];
const SLEEP = Symbol.for('WORKFLOW_SLEEP');
setLookupForTests(async () => [{ address: '93.184.215.14', family: 4 }]);

const HTML = `<html><body><article>
  <div class="ltx_abstract"><p class="ltx_p">We study speech.</p></div>
  <section id="S1"><h2 class="ltx_title">1 Introduction</h2>
    <div id="S1.p1" class="ltx_para"><p class="ltx_p">Full text</p></div>
    <figure id="S1.F1"><figcaption>Figure 1: A plot.</figcaption></figure>
  </section></article></body></html>`;
const LINE = 'Speech models learn from frozen encoders across many dialects';
const TEXT_PDF = minimalPdf([
  [
    [700, LINE],
    [686, 'and keep their accuracy.'],
  ],
]);

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
  await sql`insert into documents (path, content) values ('config/site.yml', ${"siteUrl: 'https://site.test'\n"})`;
  arxiv = {};
  fetched = [];
  agents = [];
  sleeps = [];
  (globalThis as Record<symbol, unknown>)[SLEEP] = async (d: unknown) => void sleeps.push(d);
  mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetched.push(url);
    agents.push((init!.headers as Record<string, string>)['User-Agent']);
    return arxiv[url]?.() ?? new Response('missing', { status: 404 });
  });
});
afterEach(() => {
  mock.restoreAll();
  setSqlForTests(null);
  setStoreForTests(null);
  delete (globalThis as Record<symbol, unknown>)[SLEEP];
});

const paper = (key: string, extra: Partial<NewPaper> = {}): NewPaper => ({
  key,
  source: 'arxiv',
  title: `Paper ${key}`,
  authors: ['A. Author'],
  url: `https://x.test/${key}`,
  categories: [],
  abstract: 'An abstract about speech.',
  ...extra,
});
const add = async (...papers: NewPaper[]) => (await upsertPapers(sql, papers)).map((r) => r.id);
const pids = async (id: number) => (await getPassages(sql, [id])).map((p) => p.pid);
const state = async (id: number) => {
  const { source, error, note, pages } = await readText(sql, id);
  return { source, error, note, pages };
};

test('HTML with paragraphs is stored as passages', async () => {
  const [id] = await add(paper('arxiv:2610.1', { arxiv: '2610.1' }));
  arxiv['https://arxiv.org/html/2610.1'] = () => new Response(HTML);
  assert.equal(await textNeedFor(sql, id), 'html');
  assert.deepEqual(await fetchArxivText(sql, id, 'html'), { next: null, ok: true });
  assert.deepEqual(agents, ['ScholarOS reading (+https://site.test)']);
  assert.deepEqual(await pids(id), ['abs.1', 'S1', 'S1.p1', 'S1.F1']);
  assert.deepEqual(await state(id), { source: 'arxiv-html', error: null, note: null, pages: null });
  assert.equal((await readText(sql, id)).body, HTML);
  assert.equal(await textNeedFor(sql, id), null);
});

test('an HTML 404 moves on to the PDF', async () => {
  const [id] = await add(paper('arxiv:2610.2', { arxiv: '2610.2' }));
  assert.deepEqual(await fetchArxivText(sql, id, 'html'), { next: 'pdf', ok: false });
  assert.equal((await readText(sql, id)).error, '404');
  assert.equal(await textNeedFor(sql, id), 'pdf');
  arxiv['https://arxiv.org/pdf/2610.2'] = () => new Response(TEXT_PDF);
  assert.deepEqual(await fetchArxivText(sql, id, 'pdf'), { next: null, ok: true });
  assert.deepEqual(await pids(id), ['p1.1']);
  assert.match((await getPassages(sql, [id]))[0].body, /^Speech models .* accuracy\.$/);
  assert.deepEqual(await state(id), { source: 'arxiv-pdf', error: null, note: null, pages: 1 });
  assert.equal(await textNeedFor(sql, id), null);
});

test('HTML without paragraphs moves on to the PDF too', async () => {
  const [id] = await add(paper('arxiv:2610.3', { arxiv: '2610.3' }));
  arxiv['https://arxiv.org/html/2610.3'] = () => new Response('<html><body>Conversion failed</body></html>');
  assert.deepEqual(await fetchArxivText(sql, id, 'html'), { next: 'pdf', ok: false });
  assert.equal((await readText(sql, id)).error, '404');
  assert.deepEqual(await pids(id), []);
});

test('a 503 is stored as retryable and fetched again', async () => {
  const [id] = await add(paper('arxiv:2610.4', { arxiv: '2610.4' }));
  arxiv['https://arxiv.org/html/2610.4'] = () => new Response('busy', { status: 503 });
  assert.deepEqual(await fetchArxivText(sql, id, 'html'), { next: null, ok: false });
  assert.deepEqual(await state(id), {
    source: 'arxiv-html',
    error: 'arxiv.org answered 503',
    note: null,
    pages: null,
  });
  assert.deepEqual(await pids(id), []);
  assert.equal(await textNeedFor(sql, id), 'html');
  assert.deepEqual(await missingTexts(sql, [id]), [id]);

  arxiv['https://arxiv.org/html/2610.4'] = () => new Response(HTML);
  assert.deepEqual(await fetchArxivText(sql, id, 'html'), { next: null, ok: true });
  assert.equal((await readText(sql, id)).error, null);
  assert.deepEqual(await missingTexts(sql, [id]), []);
});

test('an upload that lands while a retry is fetching is kept', async () => {
  const [id, other] = await add(paper('arxiv:2610.4', { arxiv: '2610.4' }), paper('arxiv:2610.5', { arxiv: '2610.5' }));
  const scan = minimalPdf([[[700, 'Fig. 1']]]);
  for (const p of [id, other]) await saveText(sql, p, { source: 'arxiv-html', error: 'arxiv.org answered 503' });
  // arXiv fails again, after the owner's scan was stored mid-fetch: the error is not stored over it.
  arxiv['https://arxiv.org/html/2610.4'] = async () => {
    await storeUpload(sql, id, scan);
    return new Response('busy', { status: 503 });
  };
  assert.deepEqual(await fetchArxivText(sql, id, 'html'), { next: null, ok: true });
  assert.deepEqual(await state(id), { source: 'scan', error: null, note: null, pages: 1 });
  assert.deepEqual(new Uint8Array((await readText(sql, id)).pdf!), scan);

  // arXiv answers this time, after an upload with a text layer: the upload's passages stay.
  arxiv['https://arxiv.org/html/2610.5'] = async () => {
    await storeUpload(sql, other, TEXT_PDF);
    return new Response(HTML);
  };
  assert.deepEqual(await fetchArxivText(sql, other, 'html'), { next: null, ok: true });
  assert.deepEqual(await state(other), { source: 'upload', error: null, note: null, pages: 1 });
  assert.deepEqual(await pids(other), ['p1.1']);

  // An upload before the fetch began: nothing is fetched.
  fetched = [];
  assert.deepEqual(await fetchArxivText(sql, id, 'pdf'), { next: null, ok: true });
  assert.deepEqual(fetched, []);
  assert.equal((await state(id)).source, 'scan');
});

test('a PDF that times out is retryable and keeps no passages', async () => {
  const [id] = await add(paper('arxiv:2610.5', { arxiv: '2610.5' }));
  arxiv['https://arxiv.org/pdf/2610.5'] = () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  assert.deepEqual(await fetchArxivText(sql, id, 'pdf'), { next: null, ok: false });
  assert.deepEqual(await state(id), {
    source: 'arxiv-pdf',
    error: 'arxiv.org: The operation was aborted due to timeout',
    note: null,
    pages: null,
  });
  assert.deepEqual(await pids(id), []);
  assert.equal(await textNeedFor(sql, id), 'pdf');
});

test('a scanned PDF is kept for the AI with its page count', async () => {
  const [id] = await add(paper('arxiv:2610.6', { arxiv: '2610.6' }));
  const scan = minimalPdf([[[700, 'Fig. 1']], [[700, '2']]]);
  arxiv['https://arxiv.org/pdf/2610.6'] = () => new Response(scan);
  assert.deepEqual(await fetchArxivText(sql, id, 'pdf'), { next: null, ok: true });
  assert.deepEqual(await state(id), { source: 'scan', error: null, note: null, pages: 2 });
  assert.deepEqual(new Uint8Array((await readText(sql, id)).pdf!), scan);
  assert.deepEqual(await pids(id), []);
  assert.equal(await textNeedFor(sql, id), null);
});

test('a PDF over 30 MB falls back to the abstract with its note', async () => {
  const [id] = await add(paper('arxiv:2610.7', { arxiv: '2610.7' }));
  arxiv['https://arxiv.org/pdf/2610.7'] = () => new Response(new Uint8Array(30 * 1024 * 1024 + 1));
  assert.deepEqual(await fetchArxivText(sql, id, 'pdf'), { next: null, ok: true });
  assert.deepEqual(await state(id), {
    source: 'abstract',
    error: null,
    note: "arXiv's PDF is over 30 MB",
    pages: null,
  });
  assert.deepEqual(await getPassages(sql, [id]), [
    { paperId: id, pid: 'abs.1', kind: 'p', body: 'An abstract about speech.' },
  ]);
  assert.equal(await textNeedFor(sql, id), null);
});

test('a missing or unreadable PDF falls back to the abstract', async () => {
  const [gone, broken] = await add(
    paper('arxiv:2610.8', { arxiv: '2610.8' }),
    paper('arxiv:2610.9', { arxiv: '2610.9' }),
  );
  arxiv['https://arxiv.org/pdf/2610.9'] = () => new Response('not a pdf');
  assert.deepEqual(await fetchArxivText(sql, gone, 'pdf'), { next: null, ok: true });
  assert.deepEqual(await fetchArxivText(sql, broken, 'pdf'), { next: null, ok: true });
  assert.equal((await readText(sql, gone)).note, 'arXiv has no HTML or PDF version');
  assert.equal((await readText(sql, broken)).note, "arXiv's PDF could not be read");
  assert.deepEqual(await pids(broken), ['abs.1']);
});

test('a paper not on arXiv uses its abstract', async () => {
  const [doi, bare] = await add(
    paper('doi:10.1/x', { doi: '10.1/x', source: 'openalex' }),
    paper('doi:10.1/y', { doi: '10.1/y', source: 'openalex', abstract: undefined }),
  );
  assert.equal(await textNeedFor(sql, doi), null);
  assert.equal(await textNeedFor(sql, bare), null);
  assert.deepEqual(fetched, []);
  assert.deepEqual(await state(doi), {
    source: 'abstract',
    error: null,
    note: 'This paper is not on arXiv',
    pages: null,
  });
  assert.deepEqual(await pids(doi), ['abs.1']);
  assert.equal((await readText(sql, bare)).source, 'abstract');
  assert.deepEqual(await pids(bare), []);
});

test('a stored Project 1 HTML body is split without fetching', async () => {
  const [split, empty] = await add(
    paper('arxiv:2610.10', { arxiv: '2610.10' }),
    paper('arxiv:2610.11', { arxiv: '2610.11' }),
  );
  await saveText(sql, split, { source: 'arxiv-html', body: HTML });
  await saveText(sql, empty, { source: 'arxiv-html', body: '<html><body>Full text</body></html>' });
  assert.equal(await textNeedFor(sql, split), null);
  assert.deepEqual(await pids(split), ['abs.1', 'S1', 'S1.p1', 'S1.F1']);
  assert.equal(await textNeedFor(sql, empty), 'pdf');
  assert.deepEqual(fetched, []);
});

test('ensureTexts waits for arXiv’s slot between fetches', async () => {
  const [a, b] = await add(paper('arxiv:2610.12', { arxiv: '2610.12' }), paper('arxiv:2610.13', { arxiv: '2610.13' }));
  arxiv['https://arxiv.org/html/2610.12'] = () => new Response(HTML);
  arxiv['https://arxiv.org/html/2610.13'] = () => new Response('busy', { status: 503 });
  assert.deepEqual(await ensureTexts([a, b]), { fetched: 1, failed: 1 });
  assert.deepEqual(fetched, ['https://arxiv.org/html/2610.12', 'https://arxiv.org/html/2610.13']);
  assert.equal(sleeps.length, 1);
  const [wait] = sleeps as number[];
  assert.ok(wait > 14_000 && wait <= 15_000, `waited ${wait} ms`);
});

test('ensureTexts goes from the HTML to the PDF in one run, each once', async () => {
  const [id] = await add(paper('arxiv:2610.14', { arxiv: '2610.14' }));
  arxiv['https://arxiv.org/pdf/2610.14'] = () => new Response('busy', { status: 503 });
  assert.deepEqual(await ensureTexts([id]), { fetched: 0, failed: 1 });
  assert.deepEqual(fetched, ['https://arxiv.org/html/2610.14', 'https://arxiv.org/pdf/2610.14']);
  assert.equal(sleeps.length, 1, 'the PDF waits for its own slot');
});

test('storeUpload refuses a file that is not a PDF', async () => {
  const [id] = await add(paper('doi:10.1/z', { doi: '10.1/z', source: 'openalex' }));
  await assert.rejects(
    storeUpload(sql, id, new TextEncoder().encode('hello')),
    (e) => e instanceof HttpError && e.status === 400 && e.message === 'That file is not a PDF this can read',
  );
  assert.equal((await readText(sql, id)).source, null);
  assert.deepEqual(await storeUpload(sql, id, TEXT_PDF), { source: 'upload', error: null, note: null, pages: 1 });
  assert.deepEqual(await pids(id), ['p1.1']);
});
