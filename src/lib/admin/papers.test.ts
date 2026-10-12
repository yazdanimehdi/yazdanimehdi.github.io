import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEntry } from './content';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { generateId, inferType, serpapiClient, syncPapers, type PapersDeps } from './papers';
import { SCHOLAR_JSON } from './paths';
import { UpstreamError } from './store';
import { POST as syncRoute } from '../../admin/routes/api/papers/sync';

const NOW = new Date('2026-10-12T03:00:00Z');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
let root: string;
let store: MemoryStore;
let articles: Record<string, unknown>[];
let calls: { serpapi: Record<string, string>[]; text: string[]; image: string[] };

const article = (id: string, title: string, year: string, authors = 'J Smith, A Chen') => ({
  title,
  link: `https://scholar.google.com/citations?view_op=view_citation&citation_for_view=AUTH:${id}`,
  citation_id: `AUTH:${id}`,
  authors,
  publication: `Advances in Neural Information Processing Systems 39, ${year}`,
  cited_by: { value: 3 },
  year,
});

function write(rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-'));
  write('config/scholar.yml', "authors:\n  - name: 'Jane Smith'\n    scholar_id: 'AUTH'\n");
  write('config/ai.yml', 'papers:\n  autoPost: true\n  maxPostsPerRun: 3\n');
  write(
    'src/content/publications/smith2020manual.md',
    "---\ntitle: 'Learning to Grasp: A Survey'\nauthors: ['Jane Smith']\nvenue: 'ICRA'\nyear: 2020\ntype: 'conference'\n---\n",
  );
  store = new MemoryStore(root);
  articles = [];
  calls = { serpapi: [], text: [], image: [] };
});
after(() => setStoreForTests(null));

const postJson = (title: string) =>
  JSON.stringify({ title, subtitle: 'Sub', excerpt: 'One line.', tags: ['ml'], body: 'We **did** it.' });

function deps(overrides: Partial<PapersDeps> = {}): PapersDeps {
  return {
    serpapi: async (params) => {
      calls.serpapi.push(params);
      if (params.view_op === 'view_citation') return { citation: { description: `Abstract of ${params.citation_id}` } };
      return { articles };
    },
    text: async (input) => {
      calls.text.push(input.prompt);
      return `Here you go:\n${postJson(/Title: (.*)/.exec(input.prompt)![1])}`;
    },
    image: async (prompt) => {
      calls.image.push(prompt);
      return { bytes: JPEG, contentType: 'image/jpeg' };
    },
    ...overrides,
  };
}

const state = async () => JSON.parse((await store.read(SCHOLAR_JSON))!.content);
const pubs = async () => (await store.list('src/content/publications')).map((f) => path.basename(f.path, '.md'));
const postFiles = async () => (await store.list('src/content/posts')).map((f) => path.basename(f.path, '.md'));

/** The first run, establishing the baseline. */
async function baseline() {
  articles = [article('a', 'Sparse Attention for Robots', '2026'), article('b', 'Dense Rewards', '2025')];
  return syncPapers(store, deps(), NOW);
}

test('generateId and inferType follow scripts/sync-scholar.py', () => {
  assert.equal(generateId(['J Smith', 'A Chen'], 2024, 'The Adaptive Way'), 'smith2024adaptive');
  assert.equal(generateId([], 2024, 'A of'), 'unknown2024untitled');
  assert.equal(generateId(['José Núñez'], 2023, 'On Graphs'), 'nez2023graphs');
  assert.equal(inferType('arXiv preprint arXiv:2401.01234'), 'preprint');
  assert.equal(inferType('IEEE Transactions on Robotics'), 'journal');
  assert.equal(inferType('NeurIPS Workshop on X'), 'workshop');
  assert.equal(inferType('Advances in Neural Information Processing Systems 39'), 'conference');
});

test('first run is a baseline: imports missing publications, marks everything seen, writes no posts', async () => {
  articles = [
    article('a', 'Sparse Attention for Robots', '2026'),
    article('m', 'Learning to grasp — a survey', '2020'), // the manual entry, punctuated differently
  ];
  const r = await syncPapers(store, deps(), NOW);
  assert.deepEqual(r, { imported: ['smith2026sparse'], posts: [], deferred: [], failed: [] });
  assert.deepEqual(await pubs(), ['smith2020manual', 'smith2026sparse']);
  assert.deepEqual(await postFiles(), []);
  assert.deepEqual(await state(), { seen: ['AUTH:a', 'AUTH:m'], lastRun: NOW.toISOString() });
  assert.deepEqual([calls.text, calls.image], [[], []]);
  const pub = (await readEntry(store, 'publications', 'smith2026sparse'))!.data;
  assert.deepEqual(pub, {
    title: 'Sparse Attention for Robots',
    authors: ['J Smith', 'A Chen'],
    venue: 'Advances in Neural Information Processing Systems 39',
    year: 2026,
    url: 'https://scholar.google.com/citations?view_op=view_citation&citation_for_view=AUTH:a',
    type: 'conference',
    featured: false,
  });
  assert.equal(store.log.length, 1, 'one commit');
});

test('second run: one new paper becomes a publication and a draft post with relatedPublication and coverImage', async () => {
  await baseline();
  articles = [article('c', 'Graph Planning at Scale', '2026'), ...articles];
  const r = await syncPapers(store, deps(), NOW);
  assert.deepEqual(r, { imported: ['smith2026graph'], posts: ['graph-planning-at-scale'], deferred: [], failed: [] });
  const post = (await readEntry(store, 'posts', 'graph-planning-at-scale'))!;
  assert.equal(post.data.draft, true);
  assert.equal(post.data.date, '2026-10-12');
  assert.equal(post.data.relatedPublication, 'smith2026graph');
  assert.match(String(post.data.coverImage), /graph-planning-at-scale-[0-9a-f]{6}\.jpg$/);
  assert.ok(await store.read(`${String(post.data.coverImage).replace(/^\//, '')}`), 'cover stored');
  assert.deepEqual(post.data.tags, ['ml']);
  assert.equal(post.body, 'We **did** it.\n');
  const pub = (await readEntry(store, 'publications', 'smith2026graph'))!.data;
  assert.equal(pub.abstract, 'Abstract of AUTH:c');
  assert.deepEqual(
    calls.serpapi.filter((p) => p.view_op).map((p) => p.citation_id),
    ['AUTH:c'],
    'one abstract call, only for the paper that gets a post',
  );
  assert.match(calls.text[0], /Abstract: Abstract of AUTH:c/);
  assert.deepEqual((await state()).seen, ['AUTH:a', 'AUTH:b', 'AUTH:c']);
  const last = store.log.at(-1)!;
  assert.deepEqual(last.paths.sort(), [
    'src/content/posts/graph-planning-at-scale.md',
    'src/content/publications/smith2026graph.md',
    SCHOLAR_JSON,
  ]);
});

test('a new paper whose title matches an existing publication is only marked seen', async () => {
  await baseline();
  articles = [article('d', 'LEARNING TO GRASP: a Survey.', '2026')];
  const r = await syncPapers(store, deps(), NOW);
  assert.deepEqual(r, { imported: [], posts: [], deferred: [], failed: [] });
  assert.deepEqual(await pubs(), ['smith2020manual', 'smith2025dense', 'smith2026sparse']);
  assert.ok((await state()).seen.includes('AUTH:d'));
  assert.deepEqual(calls.text, []);
});

test('a publication the owner deleted is not re-imported; an unchanged run commits nothing', async () => {
  await baseline();
  const file = (await store.read('src/content/publications/smith2025dense.md'))!;
  await store.commit([{ path: file.path, content: null }], 'delete', { [file.path]: file.version });
  const commits = store.log.length;
  const r = await syncPapers(store, deps(), NOW);
  assert.deepEqual(r, { imported: [], posts: [], deferred: [], failed: [] });
  assert.equal(await store.read('src/content/publications/smith2025dense.md'), null);
  assert.equal(store.log.length, commits);
});

test('the cap defers extra papers without importing them or marking them seen; the next run takes them', async () => {
  await baseline();
  write('config/ai.yml', 'papers:\n  autoPost: true\n  maxPostsPerRun: 1\n');
  articles = [article('e', 'Older Paper', '2025'), article('f', 'Newest Paper', '2026'), ...articles];
  const r = await syncPapers(store, deps(), NOW);
  assert.deepEqual(r, { imported: ['smith2026newest'], posts: ['newest-paper'], deferred: ['AUTH:e'], failed: [] });
  assert.ok(!(await state()).seen.includes('AUTH:e'));
  assert.ok(!(await pubs()).includes('smith2025older'));
  const next = await syncPapers(store, deps(), NOW);
  assert.deepEqual(next, { imported: ['smith2025older'], posts: ['older-paper'], deferred: [], failed: [] });
});

test('posts are generated concurrently, covers are stored one at a time, in newest-first order', async () => {
  await baseline();
  articles = [
    article('p', 'Paper One', '2026'),
    article('q', 'Paper Two', '2025'),
    article('r', 'Paper Three', '2024'),
    ...articles,
  ];
  // Resolves for everyone only once all three papers have called: a sequential run never gets past the first.
  const barrier = () => {
    let arrived = 0;
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return () => {
      if (++arrived === 3) open();
      return opened;
    };
  };
  const textBarrier = barrier();
  const imageBarrier = barrier();
  const base = deps();
  let storing = false;
  const stored: string[] = [];
  const putMedia = store.putMedia.bind(store);
  store.putMedia = async (folder, filename, base64, contentType) => {
    if (storing) throw new Error('a second putMedia started before the first resolved');
    storing = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      stored.push(filename);
      return await putMedia(folder, filename, base64, contentType);
    } finally {
      storing = false;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('posts were generated one after another')), 1000);
  });
  const run = syncPapers(
    store,
    deps({
      text: async (input) => (await textBarrier(), base.text(input)),
      image: async (prompt) => (await imageBarrier(), base.image(prompt)),
    }),
    NOW,
  );
  const r = await Promise.race([run, timeout]).finally(() => clearTimeout(timer));
  assert.deepEqual(r, {
    imported: ['smith2026paper', 'smith2025paper', 'smith2024paper'],
    posts: ['paper-one', 'paper-two', 'paper-three'],
    deferred: [],
    failed: [],
  });
  assert.deepEqual(
    stored.map((f) => f.replace(/-[0-9a-f]{6}\.jpg$/, '')),
    ['paper-one', 'paper-two', 'paper-three'],
  );
  for (const slug of r.posts)
    assert.ok((await readEntry(store, 'posts', slug))!.data.coverImage, `${slug} has a cover`);
  assert.equal((await readEntry(store, 'publications', 'smith2025paper'))!.data.abstract, 'Abstract of AUTH:q');
});

test('with autoPost off, new papers are imported without posts', async () => {
  await baseline();
  write('config/ai.yml', 'papers:\n  autoPost: false\n');
  articles = [article('g', 'Quiet Paper', '2026')];
  assert.deepEqual(await syncPapers(store, deps(), NOW), {
    imported: ['smith2026quiet'],
    posts: [],
    deferred: [],
    failed: [],
  });
  assert.deepEqual(calls.text, []);
});

test('a failed post still imports the publication, marks it seen and reports the failure', async () => {
  await baseline();
  articles = [article('h', 'Broken Post Paper', '2026')];
  const r = await syncPapers(store, deps({ text: async () => 'Sorry, I cannot help with that.' }), NOW);
  assert.deepEqual(r.imported, ['smith2026broken']);
  assert.deepEqual(r.posts, []);
  assert.deepEqual(r.failed, [
    { item: 'post for smith2026broken', error: 'The model did not return the JSON post it was asked for' },
  ]);
  assert.ok((await state()).seen.includes('AUTH:h'));
  assert.deepEqual(await postFiles(), []);
});

test('an image failure leaves the post without a cover and is reported', async () => {
  await baseline();
  articles = [article('i', 'No Cover Paper', '2026')];
  const r = await syncPapers(
    store,
    deps({
      image: async () => {
        throw new Error('OPENAI_API_KEY is not set');
      },
    }),
    NOW,
  );
  assert.deepEqual(r.posts, ['no-cover-paper']);
  assert.deepEqual(r.failed, [{ item: 'cover image for no-cover-paper', error: 'OPENAI_API_KEY is not set' }]);
  const post = (await readEntry(store, 'posts', 'no-cover-paper'))!;
  assert.equal(post.data.coverImage, undefined);
  assert.equal(post.data.draft, true);
});

test('a failing SerpApi call writes nothing, so a failed first run stays a baseline', async () => {
  const failing = deps({
    serpapi: async () => {
      throw new UpstreamError('SerpApi answered 401: Invalid API key.');
    },
  });
  await assert.rejects(syncPapers(store, failing, NOW), /Invalid API key/);
  assert.equal(await store.read(SCHOLAR_JSON), null);
  assert.equal(store.log.length, 0);
});

test('no Scholar author id: skipped, nothing fetched or written', async () => {
  write('config/scholar.yml', 'authors: []\n');
  const r = await syncPapers(store, deps(), NOW);
  assert.match(r.skipped ?? '', /no Scholar author id/);
  assert.deepEqual([calls.serpapi, store.log], [[], []]);
});

test('serpapiClient: the author request carries the params and the key; an error answer is an UpstreamError', async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string | URL) => {
    seen.push(String(url));
    const bad = new URL(String(url)).searchParams.get('api_key') === 'bad';
    return new Response(JSON.stringify(bad ? { error: 'Invalid API key.' } : { articles: [] }), {
      status: bad ? 401 : 200,
    });
  }) as typeof fetch;
  const search = serpapiClient('k1', fetchFn);
  assert.deepEqual(await search({ engine: 'google_scholar_author', author_id: 'AUTH', sort: 'pubdate', num: '100' }), {
    articles: [],
  });
  const url = new URL(seen[0]);
  assert.equal(url.origin + url.pathname, 'https://serpapi.com/search.json');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    engine: 'google_scholar_author',
    author_id: 'AUTH',
    sort: 'pubdate',
    num: '100',
    api_key: 'k1',
  });
  await assert.rejects(serpapiClient('bad', fetchFn)({ engine: 'x' }), (e: unknown) => {
    assert.ok(e instanceof UpstreamError);
    assert.equal((e as Error).message, 'SerpApi answered 401: Invalid API key.');
    return true;
  });
});

test('papers/sync route: needs a session; without SERPAPI_KEY it is a 400 naming the key', async () => {
  const saved = process.env.SERPAPI_KEY;
  delete process.env.SERPAPI_KEY;
  setStoreForTests(() => store);
  const call = (signedIn: boolean) => {
    const url = new URL('https://site.test/api/admin/papers/sync');
    return Promise.resolve(
      syncRoute({
        request: new Request(url, { method: 'POST' }),
        url,
        params: {},
        locals: signedIn ? { user: { login: 'jane', name: 'Jane', avatar: '' } } : {},
      } as never),
    );
  };
  try {
    assert.equal((await call(false)).status, 401);
    const res = await call(true);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /SERPAPI_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.SERPAPI_KEY = saved;
  }
});
