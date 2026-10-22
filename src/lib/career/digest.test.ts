import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { FLAGS } from './apply/test-kit';
import { updatePosting, upsertPostings, writeCareer } from './db';
import { digestText, sendDigest } from './digest';
import type { RunSummary } from './types';

const saved = process.env.RESEND_API_KEY;
let sql: Sql;
let sent: { url: string; init: RequestInit }[];
let answer: () => Response | Promise<Response>;
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  sent.push({ url: String(url), init: init! });
  return answer();
}) as typeof fetch;

const SUMMARY: RunSummary = {
  at: '2026-10-22T03:00:00.000Z',
  sources: [{ id: 'arbeitnow', found: 4, added: 3 }],
  scored: 3,
  failed: 0,
  deferred: 0,
  stage: 4,
  drafted: 1,
  prefilled: 1,
  handedOff: 0,
  limited: 0,
};

let n = 0;
async function posting(company: string, title: string, status: 'drafted' | 'ready'): Promise<number> {
  const key = `k${++n}`;
  await upsertPostings(sql, [
    {
      source: 's',
      externalId: key,
      company,
      title,
      url: 'https://jobs.test',
      description: '',
      format: 'text' as const,
      key,
      text: '',
      flags: FLAGS,
    },
  ]);
  const [{ id }] = await sql<{ id: number }>`select id from career_postings where key = ${key}`;
  await updatePosting(sql, Number(id), { status, score: 80 });
  return Number(id);
}
const digestOn = (digest: Record<string, unknown> = {}) =>
  writeCareer(sql, { prefs: { digest: { on: true, to: 'me@x.test', ...digest } } }, 'test');

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

test('digest is skipped with nothing new, with no key, and when off', async () => {
  await posting('Acme', 'Old ready one', 'ready');
  await digestOn();
  const quiet: RunSummary = { ...SUMMARY, drafted: 0, prefilled: 0 };
  assert.equal(await sendDigest(sql, quiet, [], fakeFetch), 'skipped', 'nothing new tonight');
  assert.equal(digestText(quiet, [], [], 'https://site.test/admin'), null);
  delete process.env.RESEND_API_KEY;
  assert.equal(await sendDigest(sql, SUMMARY, [], fakeFetch), 'skipped', 'no key');
  process.env.RESEND_API_KEY = 're_test_key';
  await writeCareer(sql, { prefs: { digest: { on: false, to: 'me@x.test' } } }, 'test');
  assert.equal(await sendDigest(sql, SUMMARY, [], fakeFetch), 'skipped', 'off');
  assert.equal(sent.length, 0);
});

test('digest posts the ready list to Resend', async () => {
  const ready = [await posting('Uber', 'Data <Scientist>', 'ready'), await posting('Lyft', 'ML Engineer', 'ready')];
  const drafted = await posting('Bolt', 'Researcher', 'drafted');
  await digestOn();

  assert.equal(await sendDigest(sql, SUMMARY, [drafted], fakeFetch), 'sent');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(new Headers(sent[0].init.headers).get('authorization'), 'Bearer re_test_key');
  const body = JSON.parse(String(sent[0].init.body));
  assert.deepEqual(body.to, ['me@x.test']);
  assert.equal(body.from, 'ScholarOS <onboarding@resend.dev>');
  assert.match(body.subject, /2 ready for approval/);
  for (const id of ready) {
    assert.ok(body.text.includes(`https://site.test/admin/career/${id}`), `text links ${id}`);
    assert.ok(body.html.includes(`href="https://site.test/admin/career/${id}"`), `html links ${id}`);
  }
  assert.ok(body.text.includes('Data <Scientist>') && body.text.includes('ML Engineer'));
  assert.ok(body.html.includes('Data &lt;Scientist&gt;') && !body.html.includes('<Scientist>'), 'escaped in HTML');
  assert.ok(body.text.includes('https://site.test/admin/career?status=ready'));
  assert.ok(body.text.includes('Researcher'), 'tonight’s drafts are listed');
});

test('the address falls back to the CV’s email; a set `from` is used', async () => {
  await posting('Uber', 'Data Scientist', 'ready');
  await digestOn({ to: '', from: 'Jobs <jobs@me.test>' });
  assert.equal(await sendDigest(sql, SUMMARY, [], fakeFetch), 'sent');
  const body = JSON.parse(String(sent[0].init.body));
  assert.deepEqual([body.to, body.from], [['ada@cv.test'], 'Jobs <jobs@me.test>']);
  await sql`update documents set content = 'cv: {}' where path = 'config/cv.yml'`;
  assert.equal(await sendDigest(sql, SUMMARY, [], fakeFetch), 'skipped', 'no address at all');
});

test('a stopped night is news: the reason is in the digest', async () => {
  await digestOn();
  const stopped: RunSummary = {
    ...SUMMARY,
    drafted: 0,
    prefilled: 0,
    stopped: 'Your Claude subscription is out of quota',
  };
  assert.equal(await sendDigest(sql, stopped, [], fakeFetch), 'sent');
  assert.match(JSON.parse(String(sent[0].init.body)).text, /out of quota/);
});

test('a Resend error is recorded, not thrown', async () => {
  await posting('Uber', 'Data Scientist', 'ready');
  await digestOn();
  answer = () =>
    Response.json(
      { statusCode: 403, message: 'You can only send testing emails to your own email address' },
      { status: 403 },
    );
  assert.equal(
    await sendDigest(sql, SUMMARY, [], fakeFetch),
    'Resend answered 403: You can only send testing emails to your own email address',
  );
  answer = () => {
    throw new TypeError('fetch failed');
  };
  assert.equal(await sendDigest(sql, SUMMARY, [], fakeFetch), 'Resend could not be reached: fetch failed');
});
