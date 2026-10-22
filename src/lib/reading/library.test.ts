import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HttpError } from '../admin/http';
import { setPaperLookupForTests } from '../admin/papers';
import { PostgresStore } from '../admin/postgres-store';
import { SourceError } from '../career/sources/http';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import { getPapers, setPaperState } from './db';
import { addPaper, parseRef } from './library';

let sql: Sql;
let urls: string[];
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  urls = [];
  setPaperLookupForTests({
    get: async (url) => {
      urls.push(url);
      if (url === 'https://api.datacite.org/dois/10.48550/arXiv.2609.14491')
        return fs.readFileSync('tests/fixtures/papers/datacite-mirage.json', 'utf8');
      throw new SourceError('Not found', 404);
    },
  });
});
after(() => setPaperLookupForTests(null));

test('parseRef reads arXiv ids, arXiv DOIs and DOIs', () => {
  const cases: [string, ReturnType<typeof parseRef>][] = [
    ['2401.01234', { arxiv: '2401.01234' }],
    [' arXiv:2401.01234v2 ', { arxiv: '2401.01234' }],
    ['https://arxiv.org/abs/2401.01234', { arxiv: '2401.01234' }],
    ['https://arxiv.org/pdf/2401.01234v3.pdf', { arxiv: '2401.01234' }],
    ['hep-th/9901001', { arxiv: 'hep-th/9901001' }],
    ['math.AG/0601001v1', { arxiv: 'math.AG/0601001' }],
    ['10.1000/xyz', { doi: '10.1000/xyz' }],
    ['https://doi.org/10.1000/XYZ', { doi: '10.1000/XYZ' }],
    ['doi:10.1038/s41586-020-2649-2', { doi: '10.1038/s41586-020-2649-2' }],
    ['10.48550/arXiv.2401.01234', { arxiv: '2401.01234' }],
    ['https://doi.org/10.48550/arXiv.2401.01234', { arxiv: '2401.01234' }],
  ];
  for (const [ref, want] of cases) assert.deepEqual(parseRef(ref), want, ref);
  for (const bad of ['', 'proteins', '2401', '10.1000', '10.1000/', 'https://example.com/2401.01234'])
    assert.equal(parseRef(bad), null, bad);
});

test('addPaper saves a paper found by arXiv id', async () => {
  const store = new PostgresStore(sql);
  const { id, added } = await addPaper(sql, store, 'arXiv:2609.14491v1');
  assert.equal(added, true);
  assert.equal(urls[0], 'https://api.datacite.org/dois/10.48550/arXiv.2609.14491');
  const [p] = await getPapers(sql, [id]);
  assert.equal(p.key, 'arxiv:2609.14491');
  assert.equal(p.arxiv, '2609.14491');
  assert.equal(p.source, 'library');
  assert.equal(p.title, 'MIRAGE: Measuring Interpolation and Redundancy in Affinity GEneralization');
  assert.deepEqual(p.authors, ['Mehdi Yazdani-Jahromi', 'Sanjay Padhi', 'Ivan Garibay']);
  assert.equal(p.url, 'https://arxiv.org/abs/2609.14491');
  assert.deepEqual(p.categories, ['q-bio.QM']);
  assert.ok((p.abstract ?? '').length > 300);
  assert.equal(p.state, 'saved');

  await setPaperState(sql, id, 'dismissed');
  assert.deepEqual(await addPaper(sql, store, 'https://arxiv.org/abs/2609.14491'), { id, added: false });
  assert.equal((await getPapers(sql, [id]))[0].state, 'saved', 'a dismissed paper comes back saved');

  const fails = (status: number, message: string) => (e: unknown) =>
    e instanceof HttpError && e.status === status && e.message === message;
  await assert.rejects(addPaper(sql, store, '2609.99999'), fails(404, 'No paper found for that id'));
  await assert.rejects(
    addPaper(sql, store, 'proteins'),
    fails(400, 'Enter an arXiv id (2401.01234) or a DOI (10.1000/xyz)'),
  );
});
