import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import type { Sql } from '../db';
import { pgliteSql } from '../pglite-sql';
import {
  addEvent,
  getPosting,
  listEvents,
  listPostings,
  readCareer,
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
