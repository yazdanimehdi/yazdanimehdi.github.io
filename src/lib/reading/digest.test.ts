import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { saveDigest, upsertPapers, writeReading } from './db';
import { readingDigestText, sendReadingDigest } from './digest';
import type { DigestSection } from './types';

const DAY = '2026-10-22';
const saved = process.env.RESEND_API_KEY;
let sql: Sql;
let sent: { url: string; init: RequestInit }[];
let answer: () => Response | Promise<Response>;
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  sent.push({ url: String(url), init: init! });
  return answer();
}) as typeof fetch;

/** Saves DAY's digest with one paper per [section, title, line]. */
async function digest(items: [DigestSection, string, string][]) {
  const stored = await upsertPapers(
    sql,
    items.map(([, title], i) => ({
      key: `arxiv:${i}`,
      source: 'arxiv',
      title,
      authors: ['A. Author'],
      url: `https://arxiv.org/abs/${i}`,
      categories: [],
    })),
  );
  await saveDigest(
    sql,
    DAY,
    items.map(([section, , line], i) => ({ paperId: stored[i].id, section, rank: i + 1, line })),
  );
}
const emailOn = (email: Record<string, unknown> = {}) =>
  writeReading(sql, { prefs: { email: { on: true, to: 'me@x.test', ...email } } }, 'test');

beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  await sql`insert into documents (path, content) values
    ('config/cv.yml', ${"cv:\n  name: 'Ada'\n  email: 'ada@cv.test'\n"}),
    ('config/site.yml', ${"siteUrl: 'https://site.test/'\n"})`;
  process.env.RESEND_API_KEY = 're_test_key';
  sent = [];
  answer = () => Response.json({ id: 'email-1' });
});
afterEach(() => {
  setSqlForTests(null);
  if (saved === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = saved;
});

test('the digest is skipped when off, without a key, and with no items', async () => {
  await emailOn();
  assert.equal(await sendReadingDigest(sql, DAY, fakeFetch), 'skipped', 'no items');
  assert.equal(readingDigestText(DAY, [], 'https://site.test/admin'), null);
  await digest([['field', 'A paper', 'Matches your field']]);
  delete process.env.RESEND_API_KEY;
  assert.equal(await sendReadingDigest(sql, DAY, fakeFetch), 'skipped', 'no key');
  process.env.RESEND_API_KEY = 're_test_key';
  await writeReading(sql, { prefs: { email: { on: false, to: 'me@x.test' } } }, 'test');
  assert.equal(await sendReadingDigest(sql, DAY, fakeFetch), 'skipped', 'off');
  await emailOn({ to: '' });
  await sql`update documents set content = 'cv: {}' where path = 'config/cv.yml'`;
  assert.equal(await sendReadingDigest(sql, DAY, fakeFetch), 'skipped', 'no address');
  assert.equal(sent.length, 0);
});

test('the digest posts both sections to Resend', async () => {
  await digest([
    ['talked', 'Talked one', '120 upvotes on Hugging Face'],
    ['talked', 'Talked two', '40 citations on OpenAlex'],
    ['field', 'Field one', 'Close to your work on proteins'],
    ['unranked', 'Unranked one', 'Not ranked tonight'],
  ]);
  await emailOn({ to: '' });

  assert.equal(await sendReadingDigest(sql, DAY, fakeFetch), 'sent');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(new Headers(sent[0].init.headers).get('authorization'), 'Bearer re_test_key');
  const body = JSON.parse(String(sent[0].init.body));
  assert.deepEqual(body.to, ['ada@cv.test'], 'falls back to the CV’s email');
  assert.equal(body.from, 'ScholarOS <onboarding@resend.dev>');
  assert.equal(body.subject, 'Reading: 2 talked about, 1 in your field');
  for (const s of [
    'People are talking about',
    'New in your field',
    'Not ranked tonight',
    'Talked one',
    'Talked two',
    'Field one',
    'Unranked one',
    '120 upvotes on Hugging Face',
    'Close to your work on proteins',
  ]) {
    assert.ok(body.text.includes(s), `text has ${s}`);
    assert.ok(body.html.includes(s), `html has ${s}`);
  }
  assert.ok(body.text.includes('https://site.test/admin/reading'));
  assert.ok(body.html.includes('href="https://site.test/admin/reading"'));
});

test('a title with <script> is escaped in the HTML', () => {
  const item = (title: string, line: string) => ({
    section: 'field' as const,
    rank: 1,
    line,
    paper: {
      id: 1,
      title,
      authors: [],
      source: 'arxiv',
      url: 'https://x.test',
      publishedAt: null,
      state: 'new' as const,
    },
  });
  const mail = readingDigestText(
    DAY,
    [item('<script>alert(1)</script>‮Hidden', 'Uses <b>bold</b> & more')],
    'https://site.test/admin',
  )!;
  assert.equal(mail.subject, 'Reading: 1 in your field');
  assert.ok(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;Hidden'));
  assert.ok(mail.html.includes('Uses &lt;b&gt;bold&lt;/b&gt; &amp; more'));
  assert.ok(!mail.html.includes('<script>') && !mail.html.includes('<b>'));
  assert.ok(!mail.text.includes('‮'), 'invisible characters are cleaned');
});

test('a Resend error is returned, not thrown', async () => {
  await digest([['field', 'A paper', 'Matches your field']]);
  await emailOn({ from: 'Papers <papers@me.test>' });
  answer = () => Response.json({ statusCode: 422, message: 'Invalid `from` field' }, { status: 422 });
  assert.equal(await sendReadingDigest(sql, DAY, fakeFetch), 'Resend answered 422: Invalid `from` field');
  assert.equal(JSON.parse(String(sent[0].init.body)).from, 'Papers <papers@me.test>');
  answer = () => {
    throw new TypeError('fetch failed');
  };
  assert.equal(await sendReadingDigest(sql, DAY, fakeFetch), 'Resend could not be reached: fetch failed');
});
