import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import {
  getPapers,
  listDigests,
  missingTexts,
  pruneCandidates,
  saveDigest,
  saveText,
  setPaperState,
  shownBefore,
  todayCount,
  upsertPapers,
} from './db';
import { addChat, addHighlight, claimOutput, createNotebook, updateNotebook } from './room-db';
import { ensurePaperNote, saveRoomNote, withTitles } from './vault-db';
import type { NewPaper } from './types';

let sql: Sql;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});

const paper = (key: string, extra: Partial<NewPaper> = {}): NewPaper => ({
  key,
  source: 'arxiv',
  title: `Paper ${key}`,
  authors: ['A. Author'],
  url: `https://x.test/${key}`,
  categories: ['cs.CL'],
  ...extra,
});
const ids = async (...papers: NewPaper[]) => (await upsertPapers(sql, papers)).map((r) => r.id);

test('upsertPapers inserts once by key and merges signals', async () => {
  const hf = { huggingface: { upvotes: 12, comments: 3, since: '2026-10-21' } };
  const [first] = await upsertPapers(sql, [paper('arxiv:1', { arxiv: '1', signals: hf })]);
  assert.equal(first.added, true);
  const [again] = await upsertPapers(sql, [
    paper('arxiv:1', {
      title: 'Another title',
      source: 'bluesky',
      doi: '10.1/x',
      abstract: 'Filled in',
      signals: { bluesky: { posts: 4, capped: false } },
    }),
  ]);
  assert.deepEqual(again, { id: first.id, added: false });
  const [p] = await getPapers(sql, [first.id]);
  assert.equal(p.title, 'Paper arxiv:1', 'metadata kept');
  assert.equal(p.source, 'arxiv', 'the first source kept');
  assert.equal(p.doi, '10.1/x', 'a null id is filled');
  assert.equal(p.abstract, 'Filled in');
  assert.equal(p.state, 'new');
  assert.deepEqual(p.signals, { ...hf, bluesky: { posts: 4, capped: false } });
});

test('getPapers returns papers in the order of the ids', async () => {
  const [a, b] = await ids(paper('a'), paper('b'));
  assert.deepEqual(
    (await getPapers(sql, [b, a])).map((p) => p.key),
    ['b', 'a'],
  );
});

test("saveDigest replaces the day's items", async () => {
  const [a, b, c] = await ids(paper('a'), paper('b'), paper('c'));
  await saveDigest(sql, '2026-10-20', [{ paperId: c, section: 'field', rank: 1, line: 'older' }]);
  await saveDigest(sql, '2026-10-21', [
    { paperId: a, section: 'talked', rank: 1, line: 'x' },
    { paperId: b, section: 'field', rank: 1, line: 'y' },
  ]);
  await saveDigest(sql, '2026-10-21', [{ paperId: b, section: 'field', rank: 1, line: 'z' }]);
  const digests = await listDigests(sql, { days: 10 });
  assert.deepEqual(
    digests.map((d) => [d.day, d.items.map((i) => [i.paper.id, i.line])]),
    [
      ['2026-10-21', [[b, 'z']]],
      ['2026-10-20', [[c, 'older']]],
    ],
  );
});

test('shownBefore ignores the given day and returns the latest earlier showing', async () => {
  const [a, b] = await ids(paper('a'), paper('b'));
  const signals = { bluesky: { posts: 9, capped: false } };
  await saveDigest(sql, '2026-10-18', [{ paperId: a, section: 'field', rank: 1, line: 'first' }]);
  await saveDigest(sql, '2026-10-20', [{ paperId: a, section: 'talked', rank: 1, line: 'later', signals }]);
  await saveDigest(sql, '2026-10-21', [{ paperId: b, section: 'field', rank: 1, line: 'today' }]);
  const shown = await shownBefore(sql, [a, b], '2026-10-21');
  assert.deepEqual([...shown], [[a, { section: 'talked', signals }]]);
  assert.deepEqual([...(await shownBefore(sql, [a], '2026-10-19'))], [[a, { section: 'field', signals: null }]]);
});

test('listDigests and todayCount leave out dismissed papers; listDigests orders talked, field, unranked', async () => {
  const [a, b, c, d] = await ids(paper('a'), paper('b'), paper('c'), paper('d'));
  await saveDigest(sql, '2026-10-21', [
    { paperId: a, section: 'unranked', rank: 1, line: 'u' },
    { paperId: b, section: 'field', rank: 2, line: 'f2' },
    { paperId: c, section: 'field', rank: 1, line: 'f1' },
    { paperId: d, section: 'talked', rank: 1, line: 't' },
  ]);
  assert.equal(await setPaperState(sql, b, 'dismissed'), true);
  assert.equal(await setPaperState(sql, 9999, 'saved'), false);
  const [day] = await listDigests(sql, { days: 1 });
  assert.deepEqual(
    day.items.map((i) => [i.section, i.paper.id]),
    [
      ['talked', d],
      ['field', c],
      ['unranked', a],
    ],
  );
  assert.equal(day.items[0].paper.title, 'Paper d');
  assert.equal(await todayCount(sql, '2026-10-21'), 3, 'the dashboard counts what the page shows');
  assert.deepEqual(await listDigests(sql, { before: '2026-10-21', days: 5 }), []);
});

test('pruneCandidates keeps saved and digested papers', async () => {
  const [old, saved, digested, recent] = await ids(paper('old'), paper('saved'), paper('digested'), paper('recent'));
  await sql`update reading_papers set found_at = now() - interval '31 days' where id <> ${recent}`;
  await setPaperState(sql, saved, 'saved');
  await saveDigest(sql, '2026-09-01', [{ paperId: digested, section: 'field', rank: 1, line: 'x' }]);
  assert.equal(await pruneCandidates(sql), 1);
  assert.deepEqual(
    (await getPapers(sql, [old, saved, digested, recent])).map((p) => p.key),
    ['saved', 'digested', 'recent'],
  );
});

test('pruneCandidates keeps an unsaved paper the owner has read in the room', async () => {
  const [untouched, inNotebook, noted, highlighted, chatted, summarized] = await ids(
    paper('untouched'),
    paper('in-notebook'),
    paper('noted'),
    paper('highlighted'),
    paper('chatted'),
    paper('summarized'),
  );
  await sql`update reading_papers set found_at = now() - interval '31 days'`;
  await updateNotebook(sql, await createNotebook(sql, 'N'), { add: inNotebook });
  await withTitles(sql, (tx) => saveRoomNote(tx, { paper: noted }, 'mine'));
  await addHighlight(sql, { paperId: highlighted, pid: 'abs.1', start: 0, end: 4, quote: 'This', comment: '' });
  await addChat(sql, { paper: chatted }, { role: 'user', body: 'Why?', cites: [] });
  await claimOutput(sql, { paper: summarized }, 'summary', null, 'claim');
  assert.equal(await pruneCandidates(sql), 1);
  assert.deepEqual(
    (await getPapers(sql, [untouched, inNotebook, noted, highlighted, chatted, summarized])).map((p) => p.key),
    ['in-notebook', 'noted', 'highlighted', 'chatted', 'summarized'],
  );
});

test('prune keeps a paper with a vault note', async () => {
  const [untouched, noted] = await ids(paper('untouched'), paper('noted'));
  await sql`update reading_papers set found_at = now() - interval '31 days'`;
  await withTitles(sql, (tx) => ensurePaperNote(tx, noted)); // an empty note, as a cited paper gets
  assert.equal(await pruneCandidates(sql), 1);
  assert.deepEqual(
    (await getPapers(sql, [untouched, noted])).map((p) => p.key),
    ['noted'],
  );
});

test('missingTexts returns papers never fetched or whose fetch failed, from any source', async () => {
  const [fetched, abstractOnly, failed, without, doiOnly] = await ids(
    paper('arxiv:1', { arxiv: '1' }),
    paper('arxiv:2', { arxiv: '2' }),
    paper('arxiv:3', { arxiv: '3' }),
    paper('arxiv:4', { arxiv: '4' }),
    paper('doi:10.1/x', { doi: '10.1/x', source: 'openalex' }),
  );
  await saveText(sql, fetched, { source: 'arxiv-html', body: '<p>x</p>' });
  await saveText(sql, abstractOnly, { source: 'abstract', note: 'arXiv has no HTML or PDF for this paper' });
  await saveText(sql, failed, { source: 'arxiv-html', error: 'HTTP 503' });
  assert.deepEqual(await missingTexts(sql, [fetched, abstractOnly, failed, without, doiOnly]), [
    failed,
    without,
    doiOnly,
  ]);
});
