import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Sql } from '../db';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { noteTitle, numberedTitle } from './vault-links';

/** A database at migration 009 (before the vault). */
async function before010(): Promise<Sql> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const f of fs.readdirSync('migrations').filter((f) => f < '010')) {
    fs.copyFileSync(path.join('migrations', f), path.join(dir, f));
  }
  const sql = pgliteSql();
  await migrate(sql, dir);
  fs.rmSync(dir, { recursive: true });
  return sql;
}

async function paper(sql: Sql, title: string, state = 'new'): Promise<number> {
  const [r] = await sql`
    insert into reading_papers (key, source, title, url, state)
    values (${'k:' + Math.random()}, 'arxiv', ${title}, 'https://x', ${state}) returning id`;
  return Number(r.id);
}

async function chat(
  sql: Sql,
  on: { paper?: number; notebook?: number },
  role: string,
  body: string,
  { cites = [] as unknown[], saved = false } = {},
) {
  const [r] = await sql`
    insert into reading_chats (paper_id, notebook_id, role, body, cites, saved_at)
    values (${on.paper ?? null}, ${on.notebook ?? null}, ${role}, ${body}, ${JSON.stringify(cites)}::text::jsonb,
      ${saved ? new Date() : null}) returning id`;
  return Number(r.id);
}

test("the migration moves Project 2's notes into the vault", async () => {
  const sql = await before010();
  const a = await paper(sql, 'Paper A', 'saved');
  const b = await paper(sql, 'Paper B');
  await paper(sql, 'Paper C');
  const d = await paper(sql, 'Paper D');
  const [nb] = await sql`insert into reading_notebooks (title) values ('N') returning id`;
  const n = Number(nb.id);
  await sql`insert into reading_notebook_papers (notebook_id, paper_id) values (${n}, ${b})`;
  await sql`insert into reading_notes (paper_id, body) values (${a}, 'mine, see [[Paper B]]'), (${d}, '  ')`;
  await sql`insert into reading_notes (notebook_id, body) values (${n}, 'nb')`;
  await sql`insert into reading_highlights (paper_id, pid, start_at, end_at, quote) values (${b}, 'p1', 0, 4, 'abcd')`;
  await chat(sql, { paper: a }, 'user', 'What is X?');
  const saved = await chat(sql, { paper: a }, 'assistant', 'X is Y.', {
    saved: true,
    cites: [{ paper: a, pid: 'p1' }],
  });
  await chat(sql, { paper: a }, 'user', 'And Z?');
  await chat(sql, { paper: a }, 'assistant', 'Z.');
  await chat(sql, { notebook: n }, 'user', 'Why B?');
  const nbSaved = await chat(sql, { notebook: n }, 'assistant', 'Because.', {
    saved: true,
    cites: [
      { paper: b, pid: 'p1' },
      { paper: b, pid: 'p2' },
    ],
  });

  assert.deepEqual(await migrate(sql), ['010_vault.sql']);

  const notes = await sql`
    select id, kind, title, body, paper_id, chat, chat_id, notebook_id from vault_notes order by id`;
  const byTitle = Object.fromEntries(notes.map((r) => [r.title, r]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['N', 'Paper A', 'Paper B', 'What is X', 'Why B']);
  assert.equal(byTitle['Paper A'].kind, 'paper');
  assert.equal(byTitle['Paper A'].body, 'mine, see [[Paper B]]');
  assert.equal(Number(byTitle['Paper A'].paper_id), a);
  assert.equal(byTitle['Paper B'].body, '');
  assert.equal(Number(byTitle['Paper B'].paper_id), b);

  const x = byTitle['What is X'];
  assert.equal(x.kind, 'chat');
  assert.equal(x.body, 'From [[Paper A]]');
  assert.equal(Number(x.chat_id), saved);
  assert.equal(x.paper_id, null);
  assert.equal(x.chat.question, 'What is X?');
  assert.equal(x.chat.answer, 'X is Y.');
  assert.deepEqual(x.chat.cites, [{ paper: a, pid: 'p1' }]);
  const [asked] = await sql`select created_at from reading_chats where id = ${saved}`;
  assert.equal(x.chat.askedAt, new Date(asked.created_at).toISOString());

  assert.equal(byTitle['Why B'].body, 'From [[Paper B]]');
  assert.equal(Number(byTitle['Why B'].chat_id), nbSaved);

  assert.equal(byTitle.N.kind, 'free');
  assert.equal(byTitle.N.body, 'nb');
  assert.equal(Number(byTitle.N.notebook_id), n);

  const links = await sql`select n.title, l.target from vault_links l join vault_notes n on n.id = l.from_id`;
  assert.deepEqual(links.map((l) => `${l.title} → ${l.target}`).sort(), [
    'Paper A → paper b',
    'What is X → paper a',
    'Why B → paper b',
  ]);
  // The SQL helpers are gone; reading_notes stays until Task 3.
  const [fns] = await sql`select count(*)::int as n from pg_proc where proname like 'vault\\_%'`;
  assert.equal(fns.n, 0);
});

test("the migration's titles match noteTitle", async () => {
  const sql = await before010();
  const raws = [
    'Attention: Is All You Need?',
    'Résumé/CV',
    'Same',
    'Same',
    'same',
    'Tab\there\u00a0and\u2003nbsp\u0085.',
    '🙂'.repeat(120),
    '🙂'.repeat(120),
    'x'.repeat(300),
    'x'.repeat(300),
    '  ...  ',
  ];
  for (const t of raws) await paper(sql, t, 'saved');
  await migrate(sql);
  const rows = await sql<{ title: string }>`select title from vault_notes order by paper_id`;
  assert.deepEqual(
    rows.map((r) => r.title),
    [
      noteTitle(raws[0]),
      'Résumé CV',
      'Same',
      'Same (2)',
      'same (3)',
      'Tab here and nbsp',
      noteTitle(raws[6]),
      numberedTitle(noteTitle(raws[7]), 2),
      noteTitle(raws[8]),
      numberedTitle(noteTitle(raws[9]), 2),
      'Untitled',
    ],
  );
  assert.equal(noteTitle(raws[1]), 'Résumé CV');
  assert.equal(noteTitle(raws[5]), 'Tab here and nbsp');
});
