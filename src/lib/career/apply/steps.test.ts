import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPosting, listEvents, updatePosting } from '../db';
import { setApplySandboxForTests } from './sandbox';
import { letterHtml, prefillStep, submitStep } from './steps';
import { approvedApp, fakeSandbox, ok, posting, readyApp, setUp, tearDown, type Kit } from './test-kit';
import type { Application } from './types';

let kit: Kit;
beforeEach(async () => {
  kit = await setUp();
});
afterEach(tearDown);

const prefilling = (): Application => ({
  state: 'prefilling',
  at: new Date().toISOString(),
  url: 'https://jobs.test/apply',
  fields: [],
  shots: [],
});
const events = async (id: number) =>
  (await listEvents(kit.sql, id)).filter((e) => e.kind === 'apply' || e.kind === 'status').map((e) => e.detail);

test('prefill moves a drafted posting to ready with fields and screenshots', async () => {
  const id = await posting(kit.sql, prefilling());
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);

  const app = await prefillStep(id);

  assert.deepEqual(
    sb.inputs.map((i) => i.mode),
    ['read', 'fill'],
  );
  const fill = sb.inputs[1];
  assert.deepEqual(fill.values, [
    { id: 'first_name', value: 'Ada' },
    { id: 'last_name', value: 'Lovelace' },
    { id: 'email', value: 'ada@example.com' },
    { id: 'resume', value: 'cv' },
    { id: 'cover_letter', value: 'letter' },
    { id: 'why', value: 'The engines.' },
  ]);
  assert.equal(sb.written.get(fill.files!.cv!)?.toString(), '%PDF https://blob.test/career/cv.pdf', 'the tailored CV');
  assert.match(fill.letterHtml ?? '', /I &lt;b&gt;build&lt;\/b&gt; engines\./);
  assert.equal(kit.aiCalls(), 1);

  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.status, 'ready');
  assert.deepEqual(p.application, app);
  assert.equal(app?.state, 'ready');
  assert.equal(app?.url, 'https://jobs.test/apply');
  assert.equal(app?.cvPdf, 'https://blob.test/career/cv.pdf');
  assert.deepEqual(
    app?.fields.map((f) => [f.id, f.value, f.source]),
    [
      ['first_name', 'Ada', 'cv'],
      ['last_name', 'Lovelace', 'cv'],
      ['email', 'ada@example.com', 'cv'],
      ['resume', 'cv', 'file'],
      ['cover_letter', 'letter', 'file'],
      ['why', 'The engines.', 'ai'],
    ],
  );
  assert.equal(app?.shots.length, 1);
  assert.match(app!.shots[0], /^https:\/\/blob\.test\/career\/\d+\/filled-1\.png$/);
  assert.match(app!.letterPdf!, /^https:\/\/blob\.test\/career\/\d+\/letter\.pdf$/);
  assert.equal(sb.stops, 2, 'the session stops after each run');
  assert.deepEqual(await events(id), ['drafted → ready', 'ready'], 'newest first');
});

test('prefill without a cover letter leaves the cover-letter upload empty', async () => {
  const id = await posting(kit.sql, prefilling());
  await updatePosting(kit.sql, id, { letter: '' });
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);

  const app = await prefillStep(id);

  assert.equal(app?.state, 'ready', app?.reason);
  assert.deepEqual(
    sb.inputs[1].values?.find((v) => v.id === 'cover_letter'),
    { id: 'cover_letter', value: '' },
  );
});

test('prefill hands off on a captcha and keeps status drafted', async () => {
  const id = await posting(kit.sql, prefilling());
  const sb = fakeSandbox((input) => ({ ...ok(input), ok: false, blocker: 'captcha' }));
  setApplySandboxForTests(sb.api);

  const app = await prefillStep(id);

  assert.deepEqual(
    sb.inputs.map((i) => i.mode),
    ['read'],
    'nothing is filled',
  );
  assert.equal(app?.state, 'handoff');
  assert.match(app?.reason ?? '', /captcha/i);
  assert.equal((await getPosting(kit.sql, id))!.status, 'drafted');
});

test('prefill hands off when a required field has no confident answer, without filling', async () => {
  const id = await posting(kit.sql, prefilling());
  const sb = fakeSandbox((input) =>
    ok(input, {
      fields: [
        ...ok(input).fields,
        { id: 'start', label: 'Earliest start', kind: 'text', required: true, value: '', source: 'owner' },
      ],
    }),
  );
  setApplySandboxForTests(sb.api);

  const app = await prefillStep(id);

  assert.equal(app?.state, 'handoff');
  assert.equal(app?.reason, 'Needs your answer: Earliest start');
  assert.deepEqual(
    sb.inputs.map((i) => i.mode),
    ['read'],
  );
});

test('prefill hands off when filling makes the form ask more', async () => {
  const id = await posting(kit.sql, prefilling());
  const extra = {
    id: 'visa',
    label: 'Which visa?',
    kind: 'text' as const,
    required: false,
    value: '',
    source: 'owner' as const,
  };
  setApplySandboxForTests(
    fakeSandbox((input) => (input.mode === 'fill' ? ok(input, { fields: [...ok(input).fields, extra] }) : ok(input)))
      .api,
  );
  const app = await prefillStep(id);
  assert.equal(app?.state, 'handoff');
  assert.match(app?.reason ?? '', /more questions/);
  assert.equal((await getPosting(kit.sql, id))!.status, 'drafted');
});

test('prefill does nothing unless the posting is prefilling', async () => {
  const id = await posting(kit.sql, readyApp());
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);
  assert.equal((await prefillStep(id))?.state, 'ready');
  assert.equal(sb.inputs.length, 0);
});

test('the apply sandbox gets no secrets and a network policy closed to private ranges', async () => {
  const id = await posting(kit.sql, prefilling());
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);
  await prefillStep(id);
  const deny = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '127.0.0.0/8', '100.64.0.0/10'];
  assert.ok(sb.policies.length > 0);
  for (const p of sb.policies) {
    assert.deepEqual(p.allow, { '*': [] });
    for (const range of deny) assert.ok(p.subnets?.deny?.includes(range), range);
  }
  for (const s of sb.scripts) assert.deepEqual(s.env ?? {}, {}, s.script);
  const runner = [...sb.written.keys()].find((k) => k.endsWith('/runner.mjs'))!;
  assert.match(sb.written.get(runner)!.toString(), /export async function run\(input, chromium\)/);
});

test('submit refuses a posting already submitting or submitted', async () => {
  for (const state of ['submitting', 'submitted', 'unconfirmed', 'ready'] as const) {
    const id = await posting(kit.sql, approvedApp({ state }));
    const sb = fakeSandbox((input) => ok(input));
    setApplySandboxForTests(sb.api);
    const app = await submitStep(id);
    assert.equal(app?.state, state, state);
    assert.equal(sb.inputs.length, 0, `${state}: no sandbox call`);
    assert.equal(sb.created, 0, state);
  }
});

test('two submits of one approval run the browser once', async () => {
  const id = await posting(kit.sql, approvedApp());
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);
  await Promise.all([submitStep(id), submitStep(id)]);
  assert.equal(sb.inputs.length, 1);
  assert.equal((await submitStep(id))?.state, 'submitted');
  assert.equal(sb.inputs.length, 1);
});

test('submit fills exactly the approved values and sets status submitted when confirmed', async () => {
  const approved = approvedApp();
  approved.approved!.fields = approved.approved!.fields.map((f) =>
    f.id === 'why' ? { ...f, value: 'Edited by me.', source: 'owner' } : f,
  );
  const id = await posting(kit.sql, approved);
  await updatePosting(kit.sql, id, { status: 'ready' });
  const sb = fakeSandbox((input) => ok(input));
  setApplySandboxForTests(sb.api);

  const app = await submitStep(id);

  const [input] = sb.inputs;
  assert.equal(input.mode, 'submit');
  assert.equal(input.url, 'https://jobs.test/form');
  assert.deepEqual(input.expect, approved.approved!.fields);
  assert.equal(input.values?.find((v) => v.id === 'why')?.value, 'Edited by me.');
  assert.equal(sb.written.get(input.files!.cv!)?.toString(), '%PDF https://blob.test/career/cv.pdf');
  assert.equal(sb.written.get(input.files!.letter!)?.toString(), '%PDF https://blob.test/career/1/letter.pdf');
  assert.equal(app?.state, 'submitted');
  assert.match(app?.confirmation ?? '', /confirmation\.png$/);
  const p = (await getPosting(kit.sql, id))!;
  assert.equal(p.status, 'submitted');
  assert.deepEqual(await events(id), ['ready → submitted', 'submitted', 'submitting'], 'newest first');
});

test('submit sets status submitted only when confirmed', async () => {
  const id = await posting(kit.sql, approvedApp());
  await updatePosting(kit.sql, id, { status: 'ready' });
  setApplySandboxForTests(fakeSandbox((input) => ok(input, { confirmed: false })).api);
  const app = await submitStep(id);
  assert.equal(app?.state, 'unconfirmed');
  assert.equal((await getPosting(kit.sql, id))!.status, 'ready');
});

test('a submit whose browser run is lost is unconfirmed, never failed', async () => {
  const id = await posting(kit.sql, approvedApp());
  await updatePosting(kit.sql, id, { status: 'ready' });
  setApplySandboxForTests(fakeSandbox(() => 'lost').api);
  const app = await submitStep(id);
  assert.equal(app?.state, 'unconfirmed');
  assert.match(app?.reason ?? '', /timed out/);
  assert.equal((await getPosting(kit.sql, id))!.status, 'ready');
});

test('submit stops with state changed when the runner reports changed fields', async () => {
  const id = await posting(kit.sql, approvedApp());
  await updatePosting(kit.sql, id, { status: 'ready' });
  setApplySandboxForTests(
    fakeSandbox((input) => ({
      ...ok(input),
      ok: false,
      confirmed: undefined,
      shots: [],
      changed: ['label:earliest start date'],
      error: 'the form changed since it was approved',
    })).api,
  );
  const app = await submitStep(id);
  assert.equal(app?.state, 'changed');
  assert.match(app?.reason ?? '', /earliest start date/);
  assert.equal((await getPosting(kit.sql, id))!.status, 'ready');
});

test('letterHtml escapes the letter and puts the name on top', () => {
  const html = letterHtml('Dear <team>,\n\nI build & ship.\nDaily.', 'Ada "A" Lovelace');
  assert.match(html, /<h1>Ada &quot;A&quot; Lovelace<\/h1>/);
  assert.match(html, /<p>Dear &lt;team&gt;,<\/p>\s*<p>I build &amp; ship\.<br>Daily\.<\/p>/);
  assert.doesNotMatch(html, /<team>/);
});
