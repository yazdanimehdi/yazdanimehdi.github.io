import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { setSqlForTests, type Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { setStoreForTests } from '../admin/get-store';
import { MemoryStore } from '../admin/memory-store';
import { PostgresStore } from '../admin/postgres-store';
import { setPaperLookupForTests } from '../admin/papers';
import { nonOwnerUser, ownerUser } from '../career/test-owner';
import { getPapers, saveDigest, upsertPapers } from './db';
import * as settings from '../../admin/routes/api/reading/settings';
import * as suggest from '../../admin/routes/api/reading/suggest';
import * as topics from '../../admin/routes/api/reading/topics';
import * as run from '../../admin/routes/api/reading/run';
import * as digest from '../../admin/routes/api/reading/digest';
import * as papers from '../../admin/routes/api/reading/papers/[id]';

type User = ReturnType<typeof ownerUser>;
type Handler = (ctx: never) => Response | Promise<Response>;

let sql: Sql;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests((author) => new PostgresStore(sql, author));
});
after(() => {
  setStoreForTests(null);
  setSqlForTests(null);
  setPaperLookupForTests(null);
});

const call = (
  handler: Handler,
  opts: { user?: User; query?: string; body?: unknown; params?: Record<string, string> } = {},
) =>
  handler({
    locals: { user: opts.user ?? ownerUser() },
    url: new URL(`http://x/api/admin/reading${opts.query ?? ''}`),
    params: opts.params ?? {},
    request: new Request('http://x/', {
      method: opts.body === undefined ? 'GET' : 'POST',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
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
