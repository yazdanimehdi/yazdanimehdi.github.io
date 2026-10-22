import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrate } from '../db-migrate';
import { setSqlForTests, type Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { MemoryStore } from '../admin/memory-store';
import { PostgresStore } from '../admin/postgres-store';
import { setPaperLookupForTests } from '../admin/papers';
import { nonOwnerUser, ownerUser } from '../career/test-owner';
import { getPapers, saveDigest, saveText, upsertPapers } from './db';
import {
  addChat,
  addHighlight,
  claimOutput,
  createNotebook,
  getNotebook,
  getOutputs,
  getPassages,
  listHighlights,
  savePassages,
  saveNote,
  setOutput,
  updateNotebook,
  useAiCall,
} from './room-db';
import { minimalPdf } from './test-pdf';
import { SourceError } from '../career/sources/http';
import { setRoomRunsForTests, type RoomRuns } from '../../workflows/reading-room';
import * as settings from '../../admin/routes/api/reading/settings';
import * as suggest from '../../admin/routes/api/reading/suggest';
import * as topics from '../../admin/routes/api/reading/topics';
import * as run from '../../admin/routes/api/reading/run';
import * as digest from '../../admin/routes/api/reading/digest';
import * as papers from '../../admin/routes/api/reading/papers/[id]';
import * as library from '../../admin/routes/api/reading/papers';
import * as pdf from '../../admin/routes/api/reading/papers/[id]/pdf';
import * as notebooks from '../../admin/routes/api/reading/notebooks';
import * as notebook from '../../admin/routes/api/reading/notebooks/[id]';
import * as outputs from '../../admin/routes/api/reading/outputs';
import * as chat from '../../admin/routes/api/reading/chat';
import * as chatMessage from '../../admin/routes/api/reading/chat/[id]';
import * as highlights from '../../admin/routes/api/reading/highlights';
import * as highlight from '../../admin/routes/api/reading/highlights/[id]';
import * as notes from '../../admin/routes/api/reading/notes';

type User = ReturnType<typeof ownerUser>;
type Handler = (ctx: never) => Response | Promise<Response>;

let sql: Sql;
/** The text and output runs started, through a fake Workflow API whose runs are always still running. */
let starts: Parameters<RoomRuns['start']>[0][];
const fakeRuns: RoomRuns = {
  get: () => ({ status: Promise.resolve('running'), createdAt: Promise.resolve(new Date()), cancel: async () => {} }),
  start: async (job) => ({ runId: `run-${starts.push(job)}` }),
};
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests((author) => new PostgresStore(sql, author));
  starts = [];
  setRoomRunsForTests(fakeRuns);
});
after(() => {
  setStoreForTests(null);
  setSqlForTests(null);
  setPaperLookupForTests(null);
  setRoomRunsForTests(null);
});

const call = (
  handler: Handler,
  opts: {
    user?: User;
    query?: string;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
) =>
  handler({
    locals: { user: opts.user ?? ownerUser() },
    url: new URL(`http://x/api/admin/reading${opts.query ?? ''}`),
    params: opts.params ?? {},
    request: new Request('http://x/', {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: opts.headers,
      body:
        opts.body === undefined
          ? undefined
          : opts.body instanceof Uint8Array
            ? new Blob([opts.body as Uint8Array<ArrayBuffer>])
            : opts.body instanceof ReadableStream
              ? opts.body
              : JSON.stringify(opts.body),
      duplex: 'half',
    } as RequestInit),
  } as never) as Promise<Response>;

const HANDLERS: [string, Handler][] = [
  ['settings GET', settings.GET],
  ['settings PUT', settings.PUT],
  ['suggest POST', suggest.POST],
  ['topics GET', topics.GET],
  ['run GET', run.GET],
  ['run POST', run.POST],
  ['digest GET', digest.GET],
  ['papers PATCH', papers.PATCH],
  ['papers/[id] GET', papers.GET],
  ['papers GET', library.GET],
  ['papers POST', library.POST],
  ['pdf POST', pdf.POST],
  ['notebooks GET', notebooks.GET],
  ['notebooks POST', notebooks.POST],
  ['notebooks/[id] GET', notebook.GET],
  ['notebooks/[id] PATCH', notebook.PATCH],
  ['notebooks/[id] DELETE', notebook.DELETE],
  ['outputs POST', outputs.POST],
  ['chat GET', chat.GET],
  ['chat POST', chat.POST],
  ['chat/[id] PATCH', chatMessage.PATCH],
  ['highlights POST', highlights.POST],
  ['highlights/[id] PATCH', highlight.PATCH],
  ['highlights/[id] DELETE', highlight.DELETE],
  ['notes PUT', notes.PUT],
];

test('every reading route is 404 for a non-owner and in git mode', async () => {
  for (const [name, h] of HANDLERS) {
    const res = await call(h, { user: nonOwnerUser(), body: {} });
    assert.equal(res.status, 404, name);
    assert.deepEqual(await res.json(), { error: 'Not found' }, name);
  }
  setStoreForTests(() => new MemoryStore());
  for (const [name, h] of HANDLERS) assert.equal((await call(h, { body: {} })).status, 404, `${name} in git mode`);
});

test('settings PUT rejects talked 21 with a field error', async () => {
  const res = await call(settings.PUT, { body: { prefs: { talked: 21 } } });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).details.talked);
  const ok = await call(settings.PUT, { body: { prefs: { talked: 3, keywords: ['proteins'] } } });
  assert.equal(ok.status, 200);
  const saved = await (await call(settings.GET)).json();
  assert.equal(saved.prefs.talked, 3);
  assert.deepEqual(saved.prefs.keywords, ['proteins']);
});

test('settings GET reports which keys are set', async () => {
  const saved = { a: process.env.OPENALEX_API_KEY, r: process.env.RESEND_API_KEY };
  process.env.OPENALEX_API_KEY = 'k';
  delete process.env.RESEND_API_KEY;
  try {
    const body = await (await call(settings.GET)).json();
    assert.deepEqual(body.keys, { OPENALEX_API_KEY: true, RESEND_API_KEY: false });
    assert.equal(body.prefs.talked, 5, 'defaults when nothing is saved');
  } finally {
    if (saved.a === undefined) delete process.env.OPENALEX_API_KEY;
    else process.env.OPENALEX_API_KEY = saved.a;
    if (saved.r !== undefined) process.env.RESEND_API_KEY = saved.r;
  }
});

const paper = (key: string) => ({
  key,
  source: 'arxiv',
  title: `Paper ${key}`,
  authors: ['A. Author'],
  url: `https://x.test/${key}`,
  categories: [],
});

test('papers PATCH saves and dismisses', async () => {
  const [{ id }] = await upsertPapers(sql, [paper('arxiv:1')]);
  const patch = (state: unknown, pid = String(id)) => call(papers.PATCH, { body: { state }, params: { id: pid } });
  const saved = await patch('saved');
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { state: 'saved' });
  assert.equal((await getPapers(sql, [id]))[0].state, 'saved');
  assert.deepEqual(await (await patch('dismissed')).json(), { state: 'dismissed' });
  assert.equal((await getPapers(sql, [id]))[0].state, 'dismissed');
  assert.equal((await patch('read')).status, 400);
  assert.equal((await patch('saved', '999')).status, 404);
  assert.equal((await patch('saved', 'x')).status, 404);
});

test('topics needs q', async () => {
  const urls: string[] = [];
  setPaperLookupForTests({
    get: async (url) => {
      urls.push(url);
      return JSON.stringify({
        results: url.includes('/fields?')
          ? [{ id: 'https://openalex.org/fields/28', display_name: 'Neuroscience' }]
          : [],
      });
    },
  });
  for (const q of ['', '?q=', '?q=%20a%20', `?q=${'x'.repeat(101)}`])
    assert.equal((await call(topics.GET, { query: q })).status, 400, q);
  assert.equal(urls.length, 0);
  const res = await call(topics.GET, { query: '?q=%20neuro%20' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [{ id: 'fields/28', name: 'Neuroscience', level: 'field' }]);
  assert.ok(urls[0].includes('search=neuro&'), 'q is trimmed');
});

test('digest lists today first', async () => {
  const [a, b] = (await upsertPapers(sql, [paper('arxiv:1'), paper('arxiv:2')])).map((r) => r.id);
  await saveDigest(sql, '2026-10-21', [{ paperId: a, section: 'field', rank: 1, line: 'yesterday' }]);
  await saveDigest(sql, '2026-10-22', [{ paperId: b, section: 'talked', rank: 1, line: 'today' }]);
  const body = await (await call(digest.GET)).json();
  assert.deepEqual(
    body.days.map((d: { day: string }) => d.day),
    ['2026-10-22', '2026-10-21'],
  );
  assert.equal(body.days[0].items[0].line, 'today');
  const older = await (await call(digest.GET, { query: '?before=2026-10-22&days=1' })).json();
  assert.deepEqual(
    older.days.map((d: { day: string }) => d.day),
    ['2026-10-21'],
  );
  for (const q of ['?days=0', '?days=31', '?days=x', '?before=yesterday', '?before=2026-02-30'])
    assert.equal((await call(digest.GET, { query: q })).status, 400, q);
});

test('suggest fills sources from the research areas, resolves OpenAlex names and saves nothing', async () => {
  const none = await call(suggest.POST, { body: {} });
  assert.equal(none.status, 400);
  assert.deepEqual(await none.json(), { error: 'Add a CV or research areas first' });

  await sql`insert into documents (path, content) values
    ('config/research.yml', ${'areas:\n  - title: Neuroscience\n    description: Cortical circuits\n    tags: []\n'})`;
  await call(settings.PUT, { body: { prefs: { talked: 3, sources: { bluesky: { on: false } } } } });
  setPaperLookupForTests({
    get: async (url) => {
      const search = new URL(url).searchParams.get('search')?.toLowerCase();
      const results = url.includes('/fields?')
        ? search === 'neuroscience'
          ? [{ id: 'https://openalex.org/fields/28', display_name: 'Neuroscience' }]
          : []
        : search === 'brain'
          ? [{ id: 'https://openalex.org/subfields/2805', display_name: 'Cognitive Neuroscience' }]
          : [];
      return JSON.stringify({ results });
    },
  });
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let text: unknown = {};
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ content: [{ type: 'text', text: JSON.stringify(text) }] }),
  );
  try {
    text = {
      field: 'Cortical circuits.',
      keywords: ['cortex'],
      area: 'neuroscience',
      arxiv: ['q-bio.NC'],
      biorxiv: ['neuroscience'],
      medrxiv: [],
      pubmed: 'cortex[tiab]',
      openalex: ['NEUROSCIENCE', 'brain', 'unknown'],
      huggingface: true,
    };
    const res = await call(suggest.POST, { body: {} });
    assert.equal(res.status, 200);
    const { prefs } = await res.json();
    assert.equal(prefs.talked, 3, 'the rest of the current prefs is kept');
    assert.equal(prefs.field, 'Cortical circuits.');
    assert.equal(prefs.area, 'neuroscience');
    assert.deepEqual(prefs.sources.arxiv, { on: true, categories: ['q-bio.NC'] });
    assert.deepEqual(prefs.sources.medrxiv, { on: false, categories: [] });
    assert.deepEqual(prefs.sources.pubmed, { on: true, query: 'cortex[tiab]' });
    assert.deepEqual(prefs.sources.openalex, {
      on: true,
      topics: [
        { id: 'fields/28', name: 'Neuroscience' },
        { id: 'subfields/2805', name: 'Cognitive Neuroscience' },
      ],
    });
    assert.deepEqual(prefs.sources.huggingface, { on: false }, 'not an ML area');
    assert.deepEqual(prefs.sources.bluesky, { on: false });
    assert.equal((await (await call(settings.GET)).json()).prefs.field, '', 'nothing saved');

    text = 'Sorry, I cannot help with that.';
    const bad = await call(suggest.POST, { body: {} });
    assert.equal(bad.status, 502);
    assert.deepEqual(await bad.json(), { error: 'The model did not return the settings it was asked for' });
  } finally {
    mock.restoreAll();
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

const today = () => new Date().toISOString().slice(0, 10);
const arxivPaper = (n: number) => ({ ...paper(`arxiv:2610.${n}`), arxiv: `2610.${n}` });
const add = async (...ps: ReturnType<typeof paper>[]) => (await upsertPapers(sql, ps)).map((r) => r.id);
const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, await res.clone().text());
  return status === 204 ? null : res.json();
};
const TEXT_PDF = minimalPdf([
  [
    [700, 'We show that protein language models keep their accuracy on held-out folds.'],
    [686, 'Language models trained on curated proteins generalize to unseen families.'],
  ],
]);

test('papers POST says plainly when the id is not one', async () => {
  const bad = await call(library.POST, { body: { ref: 'proteins' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'Enter an arXiv id (2401.01234) or a DOI (10.1000/xyz)' });
  assert.equal((await call(library.POST, { body: {} })).status, 400);

  setPaperLookupForTests({
    get: async (url) => {
      if (url === 'https://api.datacite.org/dois/10.48550/arXiv.2609.14491')
        return fs.readFileSync('tests/fixtures/papers/datacite-mirage.json', 'utf8');
      throw new SourceError('Not found', 404);
    },
  });
  const { id, added } = await ok(await call(library.POST, { body: { ref: '2609.14491' } }));
  assert.equal(added, true);
  assert.deepEqual(starts, [{ papers: [id], outputId: null }], 'a text-only run');
  const listed = await ok(await call(library.GET));
  assert.deepEqual(
    listed.papers.map((i: { paper: { id: number } }) => i.paper.id),
    [id],
  );
});

test('the room GET returns passages, outputs and highlights but no PDF bytes', async () => {
  const [id] = await add(arxivPaper(1));
  await savePassages(sql, id, [{ pid: 'S1.p1', kind: 'p', body: 'Hello world' }]);
  await saveText(sql, id, { source: 'scan', pdf: minimalPdf([[[700, 'x']]]), pages: 1 });
  const out = await claimOutput(sql, { paper: id }, 'summary', null, 'claim');
  await setOutput(sql, out!, { status: 'ready', body: { papers: [id], sections: [] }, runId: 'run-x' });
  await addHighlight(sql, { paperId: id, pid: 'S1.p1', start: 0, end: 5, quote: 'Hello', comment: 'hi' });
  await saveNote(sql, { paper: id }, 'my note');
  const nb = await createNotebook(sql, 'Proteins');
  await updateNotebook(sql, nb, { add: id });
  await useAiCall(sql, today(), 100);

  const res = await call(papers.GET, { params: { id: String(id) } });
  const raw = await res.clone().text();
  const body = await ok(res);
  assert.equal(body.paper.id, id);
  assert.deepEqual(body.text, { source: 'scan', error: null, note: null, pages: 1 });
  assert.deepEqual(body.passages, [{ pid: 'S1.p1', kind: 'p', body: 'Hello world' }]);
  assert.equal(body.outputs.summary.status, 'ready');
  assert.equal('runId' in body.outputs.summary, false);
  assert.equal(body.highlights[0].quote, 'Hello');
  assert.equal(body.note, 'my note');
  assert.deepEqual(body.notebooks, [{ id: nb, title: 'Proteins' }]);
  assert.deepEqual(body.use, { today: 1, cap: 100 });
  assert.ok(!/"pdf"|%PDF/.test(raw), 'no PDF bytes');
  assert.equal(starts.length, 0, 'opening a paper with its text starts nothing');
  for (const pid of ['999', 'x', '1234567890'])
    assert.equal((await call(papers.GET, { params: { id: pid } })).status, 404, pid);
});

test('a run stuck for 15 minutes is shown as stopped', async () => {
  const [id] = await add(arxivPaper(1));
  const out = await claimOutput(sql, { paper: id }, 'summary', null, 'claim');
  await sql`update reading_outputs set updated_at = now() - interval '16 minutes' where id = ${out}`;
  const fresh = await claimOutput(sql, { paper: id }, 'faq', null, 'claim');
  const { outputs: o } = await ok(await call(papers.GET, { params: { id: String(id) } }));
  assert.equal(o.summary.status, 'failed');
  assert.equal(o.summary.error, 'The run stopped before it finished.');
  assert.equal(o.faq.status, 'running');
  assert.ok(fresh);
});

test('opening a paper whose text fetch failed fetches it again', async () => {
  const [id] = await add(arxivPaper(1));
  await saveText(sql, id, { source: 'arxiv-html', error: 'arXiv answered 503' });
  await ok(await call(papers.GET, { params: { id: String(id) } }));
  assert.deepEqual(starts, [{ papers: [id], outputId: null }]);
  // While an output's run is going (and fetching the text itself), polling starts nothing more.
  await claimOutput(sql, { paper: id }, 'summary', null, 'claim');
  await ok(await call(papers.GET, { params: { id: String(id) } }));
  assert.equal(starts.length, 1);

  const nb = await createNotebook(sql, 'N');
  await updateNotebook(sql, nb, { add: id });
  starts = [];
  await ok(await call(notebook.GET, { params: { id: String(nb) } }));
  assert.deepEqual(starts, [{ papers: [id], outputId: null }], 'a notebook with a failed text fetches it again');
});

test('an upload over 4 MB is refused', async () => {
  const [id] = await add(arxivPaper(1));
  const params = { id: String(id) };
  const big = await call(pdf.POST, { params, body: TEXT_PDF, headers: { 'content-length': String(5 * 1024 * 1024) } });
  assert.equal(big.status, 413);
  assert.deepEqual(await big.json(), { error: 'PDFs up to 4 MB can be uploaded' });
  const bytes = new Uint8Array(4 * 1024 * 1024 + 1);
  bytes.set(new TextEncoder().encode('%PDF-'));
  assert.equal((await call(pdf.POST, { params, body: bytes })).status, 413, 'counted, not just the header');
  let pulled = 0;
  const endless = new ReadableStream({
    pull: (c) => void (pulled++, c.enqueue(new Uint8Array(1024 * 1024))),
  });
  assert.equal((await call(pdf.POST, { params, body: endless })).status, 413);
  assert.ok(pulled <= 6, `reading stops at the limit (${pulled} chunks pulled)`);
  assert.equal((await call(pdf.POST, { params, body: new TextEncoder().encode('hello') })).status, 400);
  assert.equal((await call(pdf.POST, { params: { id: '999' }, body: TEXT_PDF })).status, 404);
});

test('an upload replaces an abstract and clears its outputs', async () => {
  const [id, full] = await add(arxivPaper(1), arxivPaper(2));
  await savePassages(sql, id, [{ pid: 'abs.1', kind: 'p', body: 'An abstract.' }]);
  await saveText(sql, id, { source: 'abstract', note: 'arXiv has no HTML or PDF version' });
  const out = await claimOutput(sql, { paper: id }, 'summary', null, 'claim');
  await setOutput(sql, out!, { status: 'ready', body: { papers: [id], sections: [] } });

  const body = await ok(await call(pdf.POST, { params: { id: String(id) }, body: TEXT_PDF }));
  assert.deepEqual(body, { text: { source: 'upload', error: null, note: null, pages: 1 } });
  assert.deepEqual(
    (await getPassages(sql, [id])).map((p) => p.pid),
    ['p1.1'],
  );
  assert.deepEqual(await getOutputs(sql, { paper: id }), {});

  await saveText(sql, full, { source: 'arxiv-html', body: '<p>x</p>' });
  const refused = await call(pdf.POST, { params: { id: String(full) }, body: TEXT_PDF });
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: 'This paper already has its full text' });
});

test('a highlight outside its passage is refused', async () => {
  const [id] = await add(arxivPaper(1));
  await savePassages(sql, id, [{ pid: 'S1.p1', kind: 'p', body: 'Hello world' }]);
  const h = (b: Record<string, unknown>) =>
    call(highlights.POST, { body: { paper: id, pid: 'S1.p1', start: 0, end: 5, quote: 'Hello', ...b } });
  for (const b of [{ end: 12 }, { start: 5, end: 5 }, { start: -1 }, { pid: 'S9.p9' }, { quote: 'x'.repeat(2001) }])
    assert.equal((await h(b)).status, 400, JSON.stringify(b));
  assert.equal((await h({ paper: 999 })).status, 400);
  const { highlight: made } = await ok(await h({ end: 11, quote: 'Hello world' }));
  assert.equal(made.comment, '');
  const params = { id: String(made.id) };
  assert.deepEqual(await ok(await call(highlight.PATCH, { params, body: { comment: 'nice' } })), { comment: 'nice' });
  assert.equal((await listHighlights(sql, [id]))[0].comment, 'nice');
  await ok(await call(highlight.DELETE, { params }), 204);
  assert.equal((await call(highlight.DELETE, { params })).status, 404);
});

test('a notebook refuses a 21st paper', async () => {
  const { id } = await ok(await call(notebooks.POST, { body: { title: ' Proteins ' } }));
  assert.equal((await call(notebooks.POST, { body: { title: '' } })).status, 400);
  const params = { id: String(id) };
  const ids = await add(...Array.from({ length: 21 }, (_, i) => paper(`doi:10.1/${i}`)));
  for (const p of ids.slice(0, 20)) await ok(await call(notebook.PATCH, { params, body: { add: p } }));
  const full = await call(notebook.PATCH, { params, body: { add: ids[20] } });
  assert.equal(full.status, 409);
  assert.deepEqual(await full.json(), { error: 'A notebook holds up to 20 papers' });
  assert.equal((await getNotebook(sql, id))!.paperIds.length, 20);
  const looked: string[] = [];
  setPaperLookupForTests({ get: async (url) => (looked.push(url), '{}') });
  assert.equal((await call(notebook.PATCH, { params, body: { add: '2609.14491' } })).status, 409);
  assert.equal((await call(notebook.PATCH, { params: { id: '999' }, body: { add: '2609.14491' } })).status, 404);
  assert.deepEqual(looked, [], 'a full or missing notebook looks nothing up');
  assert.equal(starts.length, 0, 'papers without arXiv ids have nothing to fetch');

  await ok(await call(notebook.PATCH, { params, body: { remove: ids[0], title: 'Folding' } }));
  assert.equal((await call(notebook.PATCH, { params, body: { add: 99999 } })).status, 404, 'no such paper');
  const [ax] = await add(arxivPaper(1));
  await ok(await call(notebook.PATCH, { params, body: { add: ax } }));
  assert.deepEqual(starts, [{ papers: [ax], outputId: null }], 'adding a paper fetches its text');

  const got = await ok(await call(notebook.GET, { params }));
  assert.deepEqual(got.notebook, { id, title: 'Folding' });
  assert.equal(got.papers.length, 20);
  assert.deepEqual(got.texts[ax], { source: null, error: null, note: null, pages: null });
  assert.deepEqual(got.passages[ax], []);
  assert.deepEqual(got.use, { today: 0, cap: 100 });
  const listed = await ok(await call(notebooks.GET));
  assert.deepEqual(
    listed.notebooks.map((n: { title: string; papers: number }) => [n.title, n.papers]),
    [['Folding', 20]],
  );
  await ok(await call(notebook.DELETE, { params }), 204);
  assert.equal((await call(notebook.GET, { params })).status, 404);
  assert.equal((await call(notebook.DELETE, { params })).status, 404);
});

test('outputs POST refuses an empty notebook', async () => {
  const nb = await createNotebook(sql, 'Empty');
  const empty = await call(outputs.POST, { body: { notebook: nb, kind: 'summary' } });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'Add a paper to this notebook first' });

  const [id] = await add(arxivPaper(1));
  assert.deepEqual(await ok(await call(outputs.POST, { body: { paper: id, kind: 'faq' } })), { runId: 'run-1' });
  const again = await call(outputs.POST, { body: { paper: id, kind: 'faq' } });
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'Already being written' });
  assert.equal((await call(outputs.POST, { body: { paper: 999, kind: 'faq' } })).status, 404);
  for (const b of [{ paper: id, kind: 'poem' }, { kind: 'faq' }, { paper: id, notebook: nb, kind: 'faq' }])
    assert.equal((await call(outputs.POST, { body: b })).status, 400, JSON.stringify(b));
});

test('chat lists the messages and saves only answers', async () => {
  const [id] = await add(arxivPaper(1));
  const q = await addChat(sql, { paper: id }, { role: 'user', body: 'Why?', cites: [] });
  const a = await addChat(sql, { paper: id }, { role: 'assistant', body: 'Because.', cites: [] });
  assert.equal((await call(chatMessage.PATCH, { params: { id: String(q.id) }, body: { saved: true } })).status, 400);
  assert.deepEqual(await ok(await call(chatMessage.PATCH, { params: { id: String(a.id) }, body: { saved: true } })), {
    saved: true,
  });
  assert.equal((await call(chatMessage.PATCH, { params: { id: '999' }, body: { saved: true } })).status, 404);
  const { messages } = await ok(await call(chat.GET, { query: `?paper=${id}` }));
  assert.deepEqual(
    messages.map((m: { body: string; saved: boolean }) => [m.body, m.saved]),
    [
      ['Why?', false],
      ['Because.', true],
    ],
  );
  for (const query of ['', '?paper=x', `?paper=${id}&notebook=1`])
    assert.equal((await call(chat.GET, { query })).status, 400, query);
  assert.equal((await call(chat.POST, { body: { paper: id, question: ' ' } })).status, 400);
});

test('notes PUT saves the note of a paper or notebook', async () => {
  const [id] = await add(arxivPaper(1));
  assert.deepEqual(await ok(await call(notes.PUT, { body: { paper: id, body: 'Read §2' } })), { body: 'Read §2' });
  assert.equal((await call(notes.PUT, { body: { paper: id, body: 'x'.repeat(20_001) } })).status, 400);
  assert.equal((await call(notes.PUT, { body: { notebook: 999, body: 'x' } })).status, 404);
  const { note } = await ok(await call(papers.GET, { params: { id: String(id) } }));
  assert.equal(note, 'Read §2');
});

test("settings GET reports today's room use", async () => {
  assert.equal((await ok(await call(settings.GET))).roomUse, 0);
  await useAiCall(sql, today(), 100);
  await useAiCall(sql, today(), 100);
  assert.equal((await ok(await call(settings.GET))).roomUse, 2);
});

test('saving a paper starts a text run once', async () => {
  const [id, fetched] = await add(arxivPaper(1), arxivPaper(2));
  await saveText(sql, fetched, { source: 'arxiv-html', body: '<p>x</p>' });
  const patch = (pid: number, state: string) => call(papers.PATCH, { params: { id: String(pid) }, body: { state } });
  await ok(await patch(id, 'saved'));
  assert.deepEqual(starts, [{ papers: [id], outputId: null }]);
  await ok(await patch(id, 'dismissed'));
  await ok(await patch(fetched, 'saved'));
  assert.equal(starts.length, 1, 'no run on dismiss, nor for a paper with its text');

  setRoomRunsForTests({ ...fakeRuns, start: async () => Promise.reject(new Error('workflow down')) });
  const logged = mock.method(console, 'error', () => {});
  try {
    assert.deepEqual(await ok(await patch(id, 'saved')), { state: 'saved' }, 'a failed start never fails the save');
    assert.equal(logged.mock.callCount(), 1);
  } finally {
    logged.mock.restore();
  }
});
