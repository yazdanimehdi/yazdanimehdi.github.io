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
const gets: string[] = [];
const server = createServer(async (req, res) => {
  gets.push(req.url ?? '');
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
  { id: 'resume', value: 'cv' },
  { id: 'question_auth', value: 'Yes' },
  { id: 'why', value: 'The engines.' },
  { id: 'sponsorship', value: 'No' },
];
const WITH_LETTER = [...VALUES, { id: 'cover_letter', value: 'letter' }];

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

test('read refuses to open or follow anything but http and https', { skip }, async () => {
  const landing = await run({ mode: 'read', url: `${base}/landing-file.html`, out: await out() }, offline);
  assert.equal(landing.ok, false);
  assert.equal(landing.blocker, 'no-form');
  assert.equal(landing.url, `${base}/landing-file.html`, 'no navigation');
  assert.match(landing.error ?? '', /file:/);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)']) {
    const result = await run({ mode: 'read', url, out: await out() }, offline);
    assert.equal(result.ok, false, url);
    assert.equal(result.blocker, 'no-form', url);
    assert.deepEqual(result.fields, [], url);
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
    { mode: 'fill', url: `${base}/greenhouse.html`, values: WITH_LETTER, files: { cv, letter }, out: dir },
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
      values: WITH_LETTER,
      files: { cv: await cvFile(dir) },
      letterHtml: `<h1>Dear team</h1><p>I would like to join.</p><img src="${base}/beacon.png">
        <script>fetch('${base}/beacon-js')</script>`,
      out: dir,
    },
    offline,
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.letterPdf, join(dir, 'letter.pdf'));
  assert.equal((await readFile(join(dir, 'letter.pdf'))).subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.fields.find((f) => f.id === 'cover_letter')?.value, 'letter.pdf');
  assert.equal(result.fields.find((f) => f.id === 'resume')?.value, 'ada-cv.pdf');
  assert.deepEqual(
    gets.filter((g) => g.startsWith('/beacon')),
    [],
    'the letter page loads and runs nothing',
  );
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

/** Reads `page` as the approval, then submits `values` against it; `sent` is what the server got. */
async function submit(page: string, values: { id: string; value: string }[]) {
  const dir = await out();
  const approved = await run({ mode: 'read', url: `${base}/${page}`, out: dir }, offline);
  assert.equal(approved.ok, true, approved.error);
  const before = posts.length;
  const result = await run(
    { mode: 'submit', url: `${base}/${page}`, values, expect: approved.fields, out: dir },
    offline,
  );
  return { result, sent: posts.slice(before) };
}

test('a form that disables its inputs while sending and then shows an error is not confirmed', { skip }, async () => {
  const { result, sent } = await submit('sending.html', [{ id: 'name', value: 'Ada' }]);
  assert.deepEqual(sent, ['name=Ada']);
  assert.equal(result.ok, true, 'it may have been sent');
  assert.equal(result.confirmed, false);
});

test('"your application could not be submitted" is not a confirmation', { skip }, async () => {
  const { result, sent } = await submit('not-sent.html', [{ id: 'name', value: 'Ada' }]);
  assert.deepEqual(sent, ['name=Ada']);
  assert.equal(result.ok, true);
  assert.equal(result.confirmed, false);
});

test('submit clicks the application form’s button, not a header search', { skip }, async () => {
  const { result, sent } = await submit('search.html', [{ id: 'name', value: 'Ada' }]);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(sent, ['name=Ada'], 'the application, never the search');
  assert.equal(result.confirmed, true);
});

test('submit stops when filling reveals a field that was not approved', { skip }, async () => {
  const { result, sent } = await submit('reveal.html', [
    { id: 'name', value: 'Ada' },
    { id: 'referred', value: 'Yes' },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.changed, ['share']);
  assert.deepEqual(sent, [], 'not submitted');
});

test('submit stops when a value is undone by the page after it was chosen', { skip }, async () => {
  const { result, sent } = await submit('country.html', [
    { id: 'state', value: 'California' },
    { id: 'country', value: 'United States' },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /state/);
  assert.deepEqual(sent, [], 'not submitted');
});

const CHECKLIST = [
  { id: 'question_x[]', value: 'true' },
  { id: 'question_x[]#2', value: '' },
  { id: 'question_x[]#3', value: 'true' },
];

test('a checkbox list sharing one name pre-fills and submits the approved boxes', { skip }, async () => {
  const dir = await out();
  const url = `${base}/checklist.html`;
  const filled = await run({ mode: 'fill', url, values: CHECKLIST, out: dir }, offline);
  assert.equal(filled.ok, true, filled.error);
  assert.deepEqual(
    filled.fields.map((f) => [f.id, f.label, f.value]),
    [
      ['question_x[]', 'Python', 'true'],
      ['question_x[]#2', 'Rust', ''],
      ['question_x[]#3', 'Go', 'true'],
    ],
  );
  const sent = posts.length;
  const result = await run({ mode: 'submit', url, values: CHECKLIST, expect: filled.fields, out: dir }, offline);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.confirmed, true);
  assert.deepEqual(posts.slice(sent), ['question_x%5B%5D=python&question_x%5B%5D=go']);
});

test('a same-name checkbox inserted before the approved ones is a change', { skip }, async () => {
  const dir = await out();
  const approved = await run({ mode: 'read', url: `${base}/checklist.html`, out: dir }, offline);
  const sent = posts.length;
  const result = await run(
    { mode: 'submit', url: `${base}/checklist-more.html`, values: CHECKLIST, expect: approved.fields, out: dir },
    offline,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.changed, ['question_x[]', 'question_x[]#2', 'question_x[]#3', 'question_x[]#4']);
  assert.ok(
    result.fields.every((f) => f.value === ''),
    'nothing ticked',
  );
  assert.deepEqual(posts.slice(sent), [], 'not submitted');
});

test('an approved empty select is sent empty, not as the page default', { skip }, async () => {
  const blank = await submit('heard-blank.html', [
    { id: 'name', value: 'Ada' },
    { id: 'heard', value: '' },
  ]);
  assert.equal(blank.result.ok, true, blank.result.error);
  assert.deepEqual(blank.sent, ['name=Ada&heard=']);
  const set = await submit('heard-set.html', [
    { id: 'name', value: 'Ada' },
    { id: 'heard', value: '' },
  ]);
  assert.equal(set.result.ok, false);
  assert.match(set.result.error ?? '', /heard/);
  assert.deepEqual(set.sent, [], 'a select with no empty option cannot be sent empty');
});

test('a file field gets exactly the file its value names', { skip }, async () => {
  const dir = await out();
  const files = { cv: await cvFile(dir) };
  const url = `${base}/files.html`;
  const filled = await run(
    {
      mode: 'fill',
      url,
      values: [
        { id: 'resume', value: 'cv' },
        { id: 'transcript', value: '' },
      ],
      files,
      out: dir,
    },
    offline,
  );
  assert.equal(filled.ok, true, filled.error);
  assert.deepEqual(
    filled.fields.map((f) => [f.id, f.value]),
    [
      ['resume', 'ada-cv.pdf'],
      ['transcript', ''],
    ],
    'never the CV in a field that is not for it',
  );
  const odd = await run(
    { mode: 'fill', url, values: [{ id: 'transcript', value: 'diploma' }], files, out: dir },
    offline,
  );
  assert.equal(odd.ok, false);
  assert.match(odd.error ?? '', /transcript/);
});
