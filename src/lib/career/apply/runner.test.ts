import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type LaunchOptions } from '@playwright/test';
import { run } from './runner.mjs';

const FORMS = 'tests/fixtures/career/forms';
const skip = existsSync(chromium.executablePath())
  ? false
  : 'Playwright chromium is not installed: run `pnpm exec playwright install chromium`';

const posts: string[] = [];
const server = createServer(async (req, res) => {
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    posts.push(body);
    return res.writeHead(204).end();
  }
  try {
    const html = await readFile(join(FORMS, new URL(req.url ?? '/', 'http://x').pathname), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());
const address = server.address();
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

// Every lookup except the fixture server fails, so the captcha script never reaches the internet.
const offline = {
  launch: (o?: LaunchOptions) =>
    chromium.launch({ ...o, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] }),
};

const out = () => mkdtemp(join(tmpdir(), 'runner-'));
const shape = (fields: { id: string; label: string; kind: string; required: boolean; options?: string[] }[]) =>
  fields.map(({ id, label, kind, required, options }) => ({ id, label, kind, required, options }));

const GREENHOUSE = [
  { id: 'first_name', label: 'First Name', kind: 'text', required: true, options: undefined },
  { id: 'last_name', label: 'Last Name', kind: 'text', required: true, options: undefined },
  { id: 'email', label: 'Email', kind: 'email', required: true, options: undefined },
  { id: 'phone', label: 'Phone', kind: 'tel', required: false, options: undefined },
  { id: 'resume', label: 'Resume/CV', kind: 'file', required: true, options: undefined },
  { id: 'cover_letter', label: 'Cover Letter', kind: 'file', required: false, options: undefined },
  {
    id: 'question_auth',
    label: 'Are you authorized to work in the US?',
    kind: 'select',
    required: true,
    options: ['Yes', 'No'],
  },
  { id: 'why', label: 'Why us?', kind: 'textarea', required: false, options: undefined },
  {
    id: 'sponsorship',
    label: 'Will you require sponsorship?',
    kind: 'radio',
    required: false,
    options: ['Yes', 'No'],
  },
];

const VALUES = [
  { id: 'first_name', value: 'Ada' },
  { id: 'last_name', value: 'Lovelace' },
  { id: 'email', value: 'ada@example.com' },
  { id: 'phone', value: '+1 555 0100' },
  { id: 'question_auth', value: 'Yes' },
  { id: 'why', value: 'The engines.' },
  { id: 'sponsorship', value: 'No' },
];

async function cvFile(dir: string) {
  const cv = join(dir, 'ada-cv.pdf');
  await writeFile(cv, '%PDF-1.4 cv');
  return cv;
}

test('read lists greenhouse fields with labels, kinds, required and options', { skip }, async () => {
  const result = await run({ mode: 'read', url: `${base}/greenhouse.html`, out: await out() }, offline);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.blocker, undefined);
  assert.deepEqual(shape(result.fields), GREENHOUSE);
});

test('read follows one Apply link from a landing page', { skip }, async () => {
  const result = await run({ mode: 'read', url: `${base}/landing.html`, out: await out() }, offline);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.url, `${base}/greenhouse.html`);
  assert.deepEqual(shape(result.fields), GREENHOUSE);
});

test('read reports no-form after one Apply click, and for a 404', { skip }, async () => {
  for (const page of ['landing-twice.html', 'missing.html']) {
    const result = await run({ mode: 'read', url: `${base}/${page}`, out: await out() }, offline);
    assert.equal(result.ok, false, page);
    assert.equal(result.blocker, 'no-form', page);
  }
});

test('read reports captcha / login / account as blockers', { skip }, async () => {
  for (const [page, blocker] of [
    ['captcha.html', 'captcha'],
    ['login.html', 'login'],
    ['account.html', 'account'],
  ]) {
    const result = await run({ mode: 'read', url: `${base}/${page}`, out: await out() }, offline);
    assert.equal(result.ok, false, page);
    assert.equal(result.blocker, blocker, page);
  }
});

test('fill fills values, uploads files, writes a screenshot and never submits', { skip }, async () => {
  const dir = await out();
  const cv = await cvFile(dir);
  const letter = join(dir, 'my-letter.pdf');
  await writeFile(letter, '%PDF-1.4 letter');
  const sent = posts.length;
  const result = await run(
    { mode: 'fill', url: `${base}/greenhouse.html`, values: VALUES, files: { cv, letter }, out: dir },
    offline,
  );
  assert.equal(result.ok, true, result.error);
  const value = Object.fromEntries(result.fields.map((f) => [f.id, f.value]));
  assert.deepEqual(value, {
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone: '+1 555 0100',
    resume: 'ada-cv.pdf',
    cover_letter: 'my-letter.pdf',
    question_auth: 'Yes',
    why: 'The engines.',
    sponsorship: 'No',
  });
  assert.deepEqual(result.shots, [join(dir, 'filled-1.png')]);
  assert.ok((await readFile(result.shots[0])).subarray(1, 4).toString() === 'PNG');
  assert.equal(posts.length, sent, 'fill never submits');
});

test('fill renders letterHtml to letter.pdf and uploads it to the cover-letter field', { skip }, async () => {
  const dir = await out();
  const result = await run(
    {
      mode: 'fill',
      url: `${base}/greenhouse.html`,
      values: VALUES,
      files: { cv: await cvFile(dir) },
      letterHtml: '<h1>Dear team</h1><p>I would like to join.</p>',
      out: dir,
    },
    offline,
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.letterPdf, join(dir, 'letter.pdf'));
  assert.equal((await readFile(join(dir, 'letter.pdf'))).subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.fields.find((f) => f.id === 'cover_letter')?.value, 'letter.pdf');
  assert.equal(result.fields.find((f) => f.id === 'resume')?.value, 'ada-cv.pdf');
});

test('submit stops when a required field was added', { skip }, async () => {
  const dir = await out();
  const approved = await run({ mode: 'read', url: `${base}/greenhouse.html`, out: dir }, offline);
  const sent = posts.length;
  const result = await run(
    {
      mode: 'submit',
      url: `${base}/changed.html`,
      values: VALUES,
      expect: approved.fields,
      files: { cv: await cvFile(dir) },
      out: dir,
    },
    offline,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.changed, ['label:earliest start date']);
  assert.equal(result.fields.find((f) => f.id === 'first_name')?.value, '', 'nothing typed');
  assert.equal(posts.length, sent, 'not submitted');
});

test('submit refuses when a typed value does not stick', { skip }, async () => {
  const dir = await out();
  const approved = await run({ mode: 'read', url: `${base}/stuck.html`, out: dir }, offline);
  const sent = posts.length;
  const result = await run(
    {
      mode: 'submit',
      url: `${base}/stuck.html`,
      values: [{ id: 'name', value: 'Ada Lovelace' }],
      expect: approved.fields,
      out: dir,
    },
    offline,
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /name/);
  assert.equal(posts.length, sent, 'not submitted');
});

test('submit fills the approved values, submits and confirms', { skip }, async () => {
  const dir = await out();
  const approved = await run({ mode: 'read', url: `${base}/greenhouse.html`, out: dir }, offline);
  const sent = posts.length;
  const result = await run(
    {
      mode: 'submit',
      url: `${base}/greenhouse.html`,
      values: VALUES,
      expect: approved.fields,
      files: { cv: await cvFile(dir) },
      out: dir,
    },
    offline,
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.confirmed, true);
  assert.deepEqual(result.shots, [join(dir, 'confirmation.png')]);
  assert.ok(existsSync(result.shots[0]));
  assert.equal(posts.length, sent + 1, 'submitted once');
  for (const v of ['Ada', 'Lovelace', 'ada@example.com', 'The engines.', '%PDF-1.4 cv']) {
    assert.ok(posts.at(-1)?.includes(v), v);
  }
});

test('the CLI prints one JSON line', { skip }, async () => {
  const dir = await out();
  const input = join(dir, 'input.json');
  await writeFile(input, JSON.stringify({ mode: 'read', url: `${base}/lever.html`, out: dir }));
  const { stdout } = await promisify(execFile)(process.execPath, ['src/lib/career/apply/runner.mjs', input]);
  const lines = stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const result = JSON.parse(lines[0]);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(shape(result.fields), [
    { id: 'name', label: 'Full name', kind: 'text', required: true, options: undefined },
    { id: 'email', label: 'Email', kind: 'email', required: true, options: undefined },
    { id: 'urls[LinkedIn]', label: 'LinkedIn', kind: 'url', required: false, options: undefined },
    { id: 'resume', label: 'Resume', kind: 'file', required: true, options: undefined },
    { id: 'consent', label: 'I agree to the privacy policy', kind: 'checkbox', required: true, options: undefined },
  ]);
});
