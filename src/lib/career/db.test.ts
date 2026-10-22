import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import type { Application } from './apply/types';
import {
  addEvent,
  approvedPostings,
  companyApplications,
  feedPostings,
  getPosting,
  listEvents,
  listPostings,
  readCareer,
  readyPostings,
  updatePosting,
  upsertPostings,
  writeCareer,
} from './db';
import type { GuardFlags, RawPosting } from './types';

let sql: Sql;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});

const flags: GuardFlags = {
  hiddenBlocks: [],
  hiddenUrls: [],
  invisible: { zero_width: 0, bidi: 0, format: 0, bom: 0 },
  invisibleFlagged: 0,
  instructionLines: [],
  mixedScript: [],
  warn: false,
};
const row = (key: string): RawPosting & { key: string; text: string; flags: GuardFlags } => ({
  key,
  source: 'greenhouse',
  externalId: key,
  company: 'Acme',
  title: 'Engineer',
  url: 'https://x.test/1',
  description: '<raw>',
  format: 'html',
  text: 'guarded',
  flags,
});

test("re-finding a posting keeps the owner's status and notes", async () => {
  assert.equal(await upsertPostings(sql, [row('K')]), 1);
  const [{ id }] = await listPostings(sql, {});
  const first = await getPosting(sql, id);
  assert.equal(first!.description, 'guarded');
  await updatePosting(sql, id, { status: 'skipped', notes: 'no' });
  assert.equal(await upsertPostings(sql, [row('K')]), 0);
  const again = await getPosting(sql, id);
  assert.equal(again!.status, 'skipped');
  assert.equal(again!.notes, 'no');
  assert.ok(again!.lastSeenAt > first!.lastSeenAt);
});

test('a row that fails to store is skipped and the rest still go in', async () => {
  const quiet = mock.method(console, 'error', () => {});
  assert.equal(await upsertPostings(sql, [row('A'), { ...row('B'), postedAt: 'not a date' }, row('C')]), 2);
  assert.equal(quiet.mock.callCount(), 1, 'the skipped row is logged');
  quiet.mock.restore();
  assert.equal((await listPostings(sql, {})).length, 2);
});

test('updatePosting stamps scored_at on score, leaves untouched fields, and clears with null', async () => {
  await upsertPostings(sql, [row('A'), row('B')]);
  const [a, b] = await listPostings(sql, {});
  await updatePosting(sql, a.id, { score: 80, scoreDetail: { why: 'fit' }, letter: 'hi' });
  await updatePosting(sql, b.id, { score: 20 });
  const p = await getPosting(sql, a.id);
  assert.equal(p!.score, 80);
  assert.deepEqual(p!.scoreDetail, { why: 'fit' });
  assert.ok(p!.scoredAt);
  assert.equal(p!.status, 'found');
  await updatePosting(sql, a.id, { letter: null });
  assert.equal((await getPosting(sql, a.id))!.letter, null);
  const list = await listPostings(sql, { scored: true });
  assert.deepEqual(
    list.map((x) => x.score),
    [80, 20],
  );
  assert.equal((await listPostings(sql, { scored: false })).length, 0);
  assert.equal((await listPostings(sql, { status: 'skipped' })).length, 0);
});

test('feedPostings groups in SQL with true counts past the per-group cap, and open hides closed statuses', async () => {
  await upsertPostings(sql, ['A', 'B', 'C', 'D', 'E', 'F'].map(row));
  const ids = (await listPostings(sql, {})).map((r) => r.id).sort((a, b) => a - b);
  await updatePosting(sql, ids[0], { score: 90 });
  await updatePosting(sql, ids[1], { score: 70 });
  await updatePosting(sql, ids[2], { score: 50, status: 'skipped' });
  await updatePosting(sql, ids[3], { score: 95, gate: 'language' });
  const feed = await feedPostings(sql, { threshold: 70, perGroup: 1 });
  assert.deepEqual(Object.fromEntries(Object.entries(feed).map(([k, g]) => [k, [g.total, g.rows.map((r) => r.id)]])), {
    matches: [2, [ids[0]]],
    below: [1, [ids[2]]],
    gated: [1, [ids[3]]],
    unscored: [2, feed.unscored.rows.map((r) => r.id)],
  });
  assert.equal(feed.unscored.rows.length, 1);
  const open = await feedPostings(sql, { status: 'open', threshold: 70 });
  assert.equal(open.below.total, 0);
  assert.equal(open.matches.total, 2);
  assert.equal((await feedPostings(sql, { status: 'skipped', threshold: 70 })).below.total, 1);
  // The schema allows a fractional threshold; it must not break the feed query.
  assert.equal((await feedPostings(sql, { threshold: 70.5 })).matches.total, 1);
});

test('events list newest first and cascade with their posting', async () => {
  await upsertPostings(sql, [row('A')]);
  const [{ id }] = await listPostings(sql, {});
  await addEvent(sql, id, 'status', 'found');
  await addEvent(sql, id, 'note');
  assert.deepEqual(
    (await listEvents(sql, id)).map((e) => e.kind),
    ['note', 'status'],
  );
});

test('readCareer on a fresh database returns empty prefs and no run', async () => {
  assert.deepEqual(await readCareer(sql), { prefs: {}, answers: {}, lastRun: null, runId: null });
});

test('writeCareer changes only the given fields', async () => {
  await writeCareer(sql, { prefs: { a: 1 } }, 'jane');
  await writeCareer(sql, { runId: 'r1' }, 'jane');
  await writeCareer(sql, { answers: { x: 'y' } }, 'jane');
  assert.deepEqual(await readCareer(sql), { prefs: { a: 1 }, answers: { x: 'y' }, lastRun: null, runId: 'r1' });
  await writeCareer(sql, { runId: null }, 'jane');
  assert.equal((await readCareer(sql)).runId, null);
});

const application = (over: Partial<Application> = {}): Application => ({
  state: 'ready',
  at: '2026-10-20T10:00:00.000Z',
  url: 'https://jobs.test/apply/1',
  fields: [{ id: 'email', label: 'Email', kind: 'email', required: true, value: 'a@b.test', source: 'cv' }],
  shots: ['https://blob.test/1.png'],
  ...over,
});

test('application round-trips through updatePosting and getPosting', async () => {
  await upsertPostings(sql, [row('A')]);
  const [{ id }] = await listPostings(sql, {});
  assert.equal((await getPosting(sql, id))!.application, null);
  const app = application({
    state: 'approved',
    reason: 'x',
    approved: { at: '2026-10-21T00:00:00.000Z', by: 'jane', fields: application().fields },
  });
  await updatePosting(sql, id, { application: app, applyRunId: 'run1' });
  const p = await getPosting(sql, id);
  assert.deepEqual(p!.application, app);
  assert.equal(p!.applyRunId, 'run1');
  await updatePosting(sql, id, { notes: 'n' });
  assert.deepEqual((await getPosting(sql, id))!.application, app, 'an unrelated patch leaves it alone');
  await updatePosting(sql, id, { application: null, applyRunId: null });
  const cleared = await getPosting(sql, id);
  assert.equal(cleared!.application, null);
  assert.equal(cleared!.applyRunId, null);
});

test('readyPostings lists only status ready, newest pre-fill first', async () => {
  await upsertPostings(sql, ['A', 'B', 'C'].map(row));
  const ids = (await listPostings(sql, {})).map((r) => r.id).sort((a, b) => a - b);
  await updatePosting(sql, ids[0], { status: 'ready', application: application({ at: '2026-10-01T00:00:00.000Z' }) });
  await updatePosting(sql, ids[1], { status: 'drafted' });
  await updatePosting(sql, ids[2], { status: 'ready', application: application({ at: '2026-10-05T00:00:00.000Z' }) });
  assert.deepEqual(
    (await readyPostings(sql)).map((r) => r.id),
    [ids[2], ids[0]],
  );
});

test('approvedPostings lists application state approved, oldest approval first', async () => {
  await upsertPostings(sql, ['A', 'B', 'C'].map(row));
  const ids = (await listPostings(sql, {})).map((r) => r.id).sort((a, b) => a - b);
  const approved = (at: string) => application({ state: 'approved', approved: { at, by: 'jane', fields: [] } });
  await updatePosting(sql, ids[0], { application: approved('2026-10-03T00:00:00.000Z') });
  await updatePosting(sql, ids[1], { application: application({ state: 'submitting' }) });
  await updatePosting(sql, ids[2], { application: approved('2026-10-02T00:00:00.000Z') });
  assert.deepEqual(await approvedPostings(sql), [ids[2], ids[0]]);
});

test('companyApplications counts the same company case-insensitively inside the window only (found_at or a status event)', async () => {
  const at = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
  await upsertPostings(sql, [
    { ...row('A'), company: 'Uber' },
    { ...row('B'), company: 'uber ' },
    { ...row('C'), company: 'Uber' },
    { ...row('D'), company: 'Uber' },
    { ...row('E'), company: 'Lyft' },
  ]);
  const ids = (await listPostings(sql, {})).map((r) => r.id).sort((a, b) => a - b);
  const set = async (id: number, status: 'drafted' | 'submitted' | 'skipped', days: number) => {
    await updatePosting(sql, id, { status });
    await sql`update career_postings set found_at = ${at(days)} where id = ${id}`;
  };
  await set(ids[0], 'drafted', 10);
  await set(ids[1], 'drafted', 10);
  await set(ids[2], 'submitted', 40);
  await set(ids[3], 'skipped', 1);
  await set(ids[4], 'drafted', 1);
  assert.equal(await companyApplications(sql, ' UBER', at(30)), 2);
  await addEvent(sql, ids[2], 'note');
  assert.equal(await companyApplications(sql, 'Uber', at(30)), 2, 'only a status event counts');
  await addEvent(sql, ids[2], 'status', 'ready → submitted');
  assert.equal(await companyApplications(sql, 'Uber', at(30)), 3);
});
