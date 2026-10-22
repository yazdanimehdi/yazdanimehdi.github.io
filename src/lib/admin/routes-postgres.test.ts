import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import type { Sql } from '../db';
import { adminSettings } from './settings';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { PostgresStore } from './postgres-store';
import { PUT as putEntry } from '../../admin/routes/api/collections/[name]/[slug]';
import { GET as listCollection } from '../../admin/routes/api/collections/[name]';
import { GET as history } from '../../admin/routes/api/history';
import { GET as revision } from '../../admin/routes/api/history/[id]';
import { POST as restore } from '../../admin/routes/api/history/[id]/restore';
import { POST as purge } from '../../admin/routes/api/cache/purge';
import { GET as dashboard } from '../../admin/routes/api/dashboard';
import { GET as me } from '../../admin/routes/api/me';
import { GET as ready } from '../../admin/routes/api/career/ready';
import { setSqlForTests } from '../db';
import { listPostings, updatePosting, upsertPostings } from '../career/db';
import { nonOwnerUser, ownerUser } from '../career/test-owner';

const user = { login: 'jane', name: 'Jane', avatar: '' };
let sql: Sql;
let purged: string[][];
let purgeFails: boolean;

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  purged = [];
  purgeFails = false;
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, {
        purge: async (tags) => {
          if (purgeFails) throw new Error('down');
          purged.push(tags);
        },
        put: async () => ({ url: 'https://x.public.blob.vercel-storage.com/a.png' }),
        del: async () => {},
      }),
  );
});

function call(
  handler: (ctx: never) => Response | Promise<Response>,
  opts: { method?: string; params?: Record<string, string>; body?: unknown; query?: string; as?: object } = {},
): Promise<Response> {
  const url = new URL(`https://site.test/api/admin/test${opts.query ?? ''}`);
  const request = new Request(url, {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return Promise.resolve(
    handler({ request, url, params: opts.params ?? {}, locals: { user: opts.as ?? user } } as never),
  );
}

const save = (title: string, version: string | null) =>
  call(putEntry, {
    method: 'PUT',
    params: { name: 'posts', slug: 'hist' },
    body: { data: { title, date: '2024-06-01' }, body: 'Hi', version },
  });

test('history: list newest first, read a revision, restore onto the current version', async () => {
  const v1 = (await (await save('One', null)).json()).versions['src/content/posts/hist.md'];
  await save('Two', v1);
  const res = await call(history, { query: '?path=src/content/posts/hist.md' });
  const revs = (await res.json()) as { id: string; version: number; author: string }[];
  assert.deepEqual(
    revs.map((r) => [r.version, r.author]),
    [
      [2, 'Jane'],
      [1, 'Jane'],
    ],
  );
  const old = await (await call(revision, { params: { id: revs[1].id } })).json();
  assert.match(old.content, /title: One/);

  const stale = await call(restore, { method: 'POST', params: { id: revs[1].id }, body: { version: '1' } });
  assert.equal(stale.status, 409);
  const ok = await call(restore, { method: 'POST', params: { id: revs[1].id }, body: { version: '2' } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).versions, { 'src/content/posts/hist.md': '3' });
});

test('history: a deletion can’t be restored; unknown ids 404; paths outside the allowlist 400', async () => {
  const v1 = (await (await save('One', null)).json()).versions['src/content/posts/hist.md'];
  const store = new PostgresStore(
    sql,
    { name: 'Jane', email: 'j@x' },
    { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} },
  );
  await store.commit([{ path: 'src/content/posts/hist.md', content: null }], 'Delete', {
    'src/content/posts/hist.md': v1,
  });
  const [deleted] = (await (await call(history, { query: '?path=src/content/posts/hist.md' })).json()) as {
    id: string;
  }[];
  assert.equal(
    (await call(restore, { method: 'POST', params: { id: deleted.id }, body: { version: null } })).status,
    400,
  );
  assert.equal((await call(revision, { params: { id: '999999' } })).status, 404);
  assert.equal((await call(history, { query: '?path=../../etc/passwd' })).status, 400);
});

test('history and purge are Postgres-only: 404 on the git stores', async () => {
  setStoreForTests(() => new MemoryStore());
  assert.equal((await call(history, { query: '?path=config/site.yml' })).status, 404);
  assert.equal((await call(purge, { method: 'POST', body: { tags: ['cfg:site'] } })).status, 404);
});

test('cache purge: validates tags, purges, 502 when it fails again', async () => {
  assert.equal((await call(purge, { method: 'POST', body: { tags: [] } })).status, 400);
  assert.equal((await call(purge, { method: 'POST', body: { tags: ['a,b'] } })).status, 400);
  assert.equal((await call(purge, { method: 'POST', body: { tags: 'cfg:site' } })).status, 400);
  assert.equal((await call(purge, { method: 'POST', body: { tags: ['cfg:site'] } })).status, 200);
  assert.deepEqual(purged.at(-1), ['cfg:site']);
  purgeFails = true;
  assert.equal((await call(purge, { method: 'POST', body: { tags: ['cfg:site'] } })).status, 502);
});

test('a save whose purge fails answers 200 with the warning and the tags to retry', async () => {
  purgeFails = true;
  const original = console.error;
  console.error = () => {};
  try {
    const res = await save('One', null);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.warning, 'cache-purge-failed');
    assert.deepEqual(body.tags, ['col:posts', 'doc:posts/hist']);
  } finally {
    console.error = original;
  }
});

test('dashboard reports the mode and the last daily jobs', async () => {
  const store = new PostgresStore(sql, undefined, {
    purge: async () => {},
    put: async () => ({ url: '' }),
    del: async () => {},
  });
  const record = { backup: { ok: true, at: '2026-10-06T03:00:00.000Z', detail: '2 file(s) changed' } };
  await store.commit(
    [
      { path: 'src/data/jobs.json', content: JSON.stringify(record) },
      { path: 'src/content/people/dash-person.md', content: '---\nname: P\nrole: phd\n---\n' },
    ],
    'r',
    {},
  );
  const outside = await (await call(dashboard)).json();
  assert.equal(outside.mode, 'static'); // tests run without VERCEL
  assert.deepEqual(outside.runs, {}, 'only Postgres mode reads the jobs record');
  const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
  process.env.VERCEL = '1';
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const body = await (await call(dashboard)).json();
    assert.equal(body.mode, 'postgres');
    assert.deepEqual(body.runs, record);
    assert.ok(body.people.count >= 1);
    assert.equal(body.people.edited.length, body.people.count, 'Postgres knows every profile edit time');
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

test('an unreachable database answers 503 JSON', async () => {
  const down = (async () => {
    throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
  }) as unknown as Sql;
  setStoreForTests((author) => new PostgresStore(down, author));
  const res = await call(listCollection, { params: { name: 'posts' } });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /unreachable/);
});

test('history: restoring a theme file needs a publisher; a normal path still restores', async () => {
  const theme = 'cv/themes/mine/Header.j2.typ';
  const store = new PostgresStore(
    sql,
    { name: 'Jane', email: 'j@x' },
    { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} },
  );
  await store.commit([{ path: theme, content: 'x' }], 'Add theme', { [theme]: null });
  const [rev] = (await (await call(history, { query: `?path=${theme}` })).json()) as { id: string }[];
  adminSettings().publishers = ['priya'];
  try {
    const denied = await call(restore, { method: 'POST', params: { id: rev.id }, body: { version: '1' } });
    assert.equal(denied.status, 403);
    adminSettings().publishers = ['jane'];
    const ok = await call(restore, { method: 'POST', params: { id: rev.id }, body: { version: '1' } });
    assert.equal(ok.status, 200);
  } finally {
    adminSettings().publishers = [];
  }
});

test('the owner learns what waits for approval: me, the dashboard and the Ready list; nobody else does', async () => {
  const flags = {
    hiddenBlocks: [],
    hiddenUrls: [],
    invisible: { zero_width: 0, bidi: 0, format: 0, bom: 0 },
    invisibleFlagged: 0,
    instructionLines: [],
    mixedScript: [],
    warn: false,
  };
  const raw = (key: string) => ({
    key,
    source: 'greenhouse',
    externalId: key,
    company: 'Acme',
    title: `Engineer ${key}`,
    url: 'https://x.test/1',
    description: '',
    format: 'html' as const,
    text: '',
    flags,
  });
  await upsertPostings(sql, ['A', 'B', 'C'].map(raw));
  const [a, b] = (await listPostings(sql, {})).map((r) => r.id).sort((x, y) => x - y);
  const at = '2026-10-21T08:00:00.000Z';
  const field = { id: 'q', label: 'Q', kind: 'text' as const, required: true, value: 'v', source: 'cv' as const };
  await updatePosting(sql, a, {
    status: 'ready',
    application: { state: 'ready', at, url: 'https://x.test/apply', fields: [field, field], shots: [] },
  });
  await updatePosting(sql, b, { status: 'ready' });
  setSqlForTests(sql);
  const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
  process.env.VERCEL = '1';
  process.env.DATABASE_URL = 'postgres://test';
  try {
    assert.deepEqual((await (await call(me, { as: ownerUser() })).json()).career, { ready: 2 });
    assert.equal((await (await call(me, { as: nonOwnerUser() })).json()).career, undefined);
    assert.deepEqual((await (await call(dashboard, { as: ownerUser() })).json()).career, { ready: 2 });
    assert.equal((await (await call(dashboard, { as: nonOwnerUser() })).json()).career, undefined);
    const rows = (await (await call(ready, { as: ownerUser() })).json()).rows;
    assert.deepEqual(
      rows.map((r: { id: number; prefilledAt: string | null; fields: number; state: string | null }) => [
        r.id,
        r.prefilledAt,
        r.fields,
        r.state,
      ]),
      [
        [a, at, 2, 'ready'],
        [b, null, 0, null],
      ],
    );
    assert.equal((await call(ready, { as: nonOwnerUser() })).status, 404);
  } finally {
    setSqlForTests(null);
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
