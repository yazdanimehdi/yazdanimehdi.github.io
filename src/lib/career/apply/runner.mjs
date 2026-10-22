// Reads, fills and submits a job application form in a headless browser. Plain code: it takes no
// instructions from the page. Run as `node runner.mjs <input.json>`; prints one JSON RunnerResult line.
import { mkdir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {'text'|'email'|'tel'|'url'|'number'|'date'|'textarea'|'select'|'radio'|'checkbox'|'file'} ApplyKind */
/**
 * @typedef {{ id: string; label: string; kind: ApplyKind; required: boolean; options?: string[];
 *   value: string; source: 'cv'|'answers'|'ai'|'handoff'|'file'|'owner'; note?: string }} ApplyField
 */
/**
 * @typedef {{ mode: 'read'|'fill'|'submit'; url: string;
 *   values?: { id: string; value: string }[];
 *   expect?: ApplyField[];
 *   files?: { cv?: string; letter?: string };
 *   letterHtml?: string;
 *   out: string }} RunnerInput
 */
/**
 * @typedef {{ ok: boolean; url: string; fields: ApplyField[];
 *   blocker?: 'captcha'|'login'|'account'|'no-form'; changed?: string[];
 *   shots: string[]; letterPdf?: string; confirmed?: boolean; error?: string }} RunnerResult
 */

const TIMEOUT = 15_000;
const CHECKED = /^(true|yes|on|1|checked)$/i;
const TEXTLIKE = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'textarea']);

/**
 * Runs inside the page, so it must stay self-contained. Lists the form fields (stamping each control with
 * `data-apply-ix` so the runner can target it), spots blockers, and stamps the Apply link and submit controls.
 */
function inspect() {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.checkVisibility({ visibilityProperty: true });
  const ownText = (el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
    return norm(copy.textContent);
  };
  const labelOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by)
      return norm(
        by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
    return norm(el.getAttribute('aria-label')) || (el.labels?.[0] ? ownText(el.labels[0]) : '');
  };
  const star = /\s*\*\s*$/;
  const KINDS = ['email', 'tel', 'url', 'number', 'date', 'file', 'checkbox', 'radio'];
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'image', 'password'];
  for (const mark of ['data-apply-ix', 'data-apply-go', 'data-apply-submit']) {
    document.querySelectorAll(`[${mark}]`).forEach((e) => e.removeAttribute(mark));
  }

  const fields = [];
  const radios = new Map();
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const type = el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase();
    // ATS forms often hide the real file input behind a styled button, so files skip the visibility check.
    if (SKIP.includes(type) || el.disabled || (type !== 'file' && !visible(el))) continue;
    const kind = type === 'textarea' || type === 'select' || KINDS.includes(type) ? type : 'text';
    const required = el.required || el.getAttribute('aria-required') === 'true';
    if (kind === 'radio') {
      const option = labelOf(el) || el.value;
      const group = radios.get(el.name);
      if (group) {
        el.dataset.applyIx = `${group.ix}:${group.field.options.length}`;
        group.field.options.push(option);
        group.field.required ||= required;
        if (el.checked) group.field.value = option;
        continue;
      }
      const box = el.closest('fieldset, [role=radiogroup]');
      const label = norm(box?.querySelector('legend')?.textContent) || (box ? labelOf(box) : '') || el.name;
      const field = {
        id: el.name || el.id,
        label,
        kind,
        required: required || box?.getAttribute('aria-required') === 'true',
        options: [option],
        value: el.checked ? option : '',
      };
      if (star.test(label)) [field.label, field.required] = [label.replace(star, ''), true];
      el.dataset.applyIx = `${fields.length}:0`;
      radios.set(el.name, { ix: fields.length, field });
      fields.push(field);
      continue;
    }
    const raw = labelOf(el);
    const label = raw.replace(star, '');
    const field = {
      id: el.name || el.id || `label:${label.toLowerCase()}`,
      label,
      kind,
      required: required || star.test(raw),
    };
    if (kind === 'select') {
      field.options = [...el.options].filter((o) => o.value !== '' && norm(o.label) !== '').map((o) => norm(o.label));
      const chosen = el.selectedOptions[0];
      field.value = chosen && chosen.value !== '' ? norm(chosen.label) : '';
    } else if (kind === 'checkbox') field.value = el.checked ? 'true' : '';
    else if (kind === 'file') field.value = el.files?.[0]?.name ?? '';
    else field.value = el.value;
    el.dataset.applyIx = String(fields.length);
    fields.push(field);
  }

  const any = (selector, test) => [...document.querySelectorAll(selector)].some(test);
  const blocker = any('script[src], iframe[src]', (e) => /recaptcha|hcaptcha|challenges\.cloudflare\.com/.test(e.src))
    ? 'captcha'
    : any('h1, h2, h3, h4, [role=heading]', (h) => /create (an |your )?account|sign up/i.test(h.textContent))
      ? 'account'
      : any('input[type=password]', visible)
        ? 'login'
        : undefined;

  const pick = (selector, re, mark) => {
    const found = [...document.querySelectorAll(selector)].filter(
      (e) => visible(e) && (!re || re.test(e.textContent || e.value)),
    );
    found.forEach((e) => e.setAttribute(mark, ''));
    return found;
  };
  const apply = pick('a, button', /^\s*apply( now| for this job)?\s*$/i, 'data-apply-go')[0];
  const submits = new Set([
    ...pick('button[type=submit], input[type=submit]', null, 'data-apply-submit'),
    ...pick('button', /^\s*submit( application)?\s*$/i, 'data-apply-submit'),
  ]).size;
  const thanks = /thank|received|submitted|application (has been|was) sent/i.test(document.body?.innerText ?? '');
  return {
    fields: fields.map((f) => ({ ...f, source: f.kind === 'file' ? 'file' : 'owner' })),
    blocker,
    apply: apply ? (apply.href ?? '') : null,
    submits,
    thanks,
  };
}

/** Re-inspects until `done` holds or `ms` pass. Inspecting fails mid-navigation, so a failure just retries. */
async function poll(page, done, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const seen = await page.evaluate(inspect).catch(() => null);
    if ((seen && done(seen)) || Date.now() > deadline) return seen ?? page.evaluate(inspect);
    await page.waitForTimeout(250);
  }
}

/** Opens the url; if it shows no form field, follows at most one Apply link or button. */
async function open(page, url) {
  await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  const seen = await page.evaluate(inspect);
  if (seen.fields.length || seen.blocker || seen.apply === null) return seen;
  if (!seen.apply) {
    await page.locator('[data-apply-go]').first().click();
    return poll(page, (s) => s.fields.length > 0 || !!s.blocker, 5_000);
  }
  await page.goto(seen.apply);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  return page.evaluate(inspect);
}

/** @param {ApplyField[]} live @param {ApplyField[]} expect @returns {string[]} ids that differ */
function diff(live, expect) {
  const sig = (f) => JSON.stringify([f.label, f.kind, f.required, f.options ?? []]);
  const a = new Map(live.map((f) => [f.id, sig(f)]));
  const b = new Map(expect.map((f) => [f.id, sig(f)]));
  return [...new Set([...a.keys(), ...b.keys()])].filter((id) => a.get(id) !== b.get(id));
}

/** Types the values in; file fields get the cover letter when labelled so, otherwise the CV. */
async function fill(page, fields, values, files) {
  const value = new Map(values.map((v) => [v.id, v.value]));
  for (const [ix, f] of fields.entries()) {
    const el = page.locator(`[data-apply-ix="${ix}"]`);
    if (f.kind === 'file') {
      const file = /cover/i.test(f.label) ? files.letter : files.cv;
      if (file) await el.setInputFiles(file);
      continue;
    }
    if (!value.has(f.id)) continue;
    const v = value.get(f.id);
    if (f.kind === 'select' || f.kind === 'radio') {
      if (v === '') continue;
      const k = f.options.indexOf(v);
      if (k < 0) throw new Error(`${f.id}: "${v}" is not one of its options`);
      if (f.kind === 'select') await el.selectOption({ label: v });
      else await page.locator(`[data-apply-ix="${ix}:${k}"]`).check();
    } else if (f.kind === 'checkbox') await el.setChecked(CHECKED.test(v));
    else await el.fill(v);
  }
}

/**
 * @param {RunnerInput} input
 * @param {Pick<import('@playwright/test').BrowserType, 'launch'>} [chromium]
 * @returns {Promise<RunnerResult>}
 */
export async function run(input, chromium) {
  /** @type {RunnerResult} */
  const result = { ok: false, url: input.url, fields: [], shots: [] };
  let browser;
  try {
    // The VM installs `playwright`; a dev checkout only has `@playwright/test`, which re-exports it.
    chromium ??= (await import('playwright').catch(() => import('@playwright/test'))).chromium;
    await mkdir(input.out, { recursive: true });
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT);

    const seen = await open(page, input.url);
    result.url = page.url();
    result.fields = seen.fields;
    if (seen.blocker || !seen.fields.length) return { ...result, blocker: seen.blocker ?? 'no-form' };
    if (input.mode === 'read') return { ...result, ok: true };
    if (input.mode === 'submit') {
      if (!input.expect) return { ...result, error: 'submit needs the approved fields (expect)' };
      const changed = diff(seen.fields, input.expect);
      if (changed.length) return { ...result, changed, error: 'the form changed since it was approved' };
    }

    const files = { ...input.files };
    if (input.mode === 'fill' && input.letterHtml) {
      const letter = await browser.newPage();
      await letter.setContent(input.letterHtml);
      files.letter = result.letterPdf = join(input.out, 'letter.pdf');
      await letter.pdf({ path: files.letter, format: 'A4' });
      await letter.close();
    }
    const values = input.values ?? [];
    await fill(page, seen.fields, values, files);
    const filled = await page.evaluate(inspect);
    result.fields = filled.fields;
    const typed = new Map(values.map((v) => [v.id, v.value]));
    const unstuck = filled.fields.filter((f) => TEXTLIKE.has(f.kind) && typed.has(f.id) && f.value !== typed.get(f.id));
    const error = unstuck.length ? `values did not stick: ${unstuck.map((f) => f.id).join(', ')}` : undefined;

    if (input.mode === 'fill') {
      result.shots.push(join(input.out, 'filled-1.png'));
      await page.screenshot({ path: result.shots[0], fullPage: true });
      return { ...result, ok: !error, error };
    }
    if (error) return { ...result, error };
    if (filled.submits !== 1) return { ...result, error: `expected one submit control, found ${filled.submits}` };
    await page.locator('[data-apply-submit]').click();
    // From here the application may have been sent, so even an error below must not read as "not submitted".
    Object.assign(result, { ok: true, confirmed: false });
    // Text that already matched before the click (a "we've received many applications" blurb) proves nothing.
    const thanked = (s) => (s.thanks && !filled.thanks) || s.fields.length === 0;
    const done = await poll(page, thanked, TIMEOUT);
    result.url = page.url();
    result.shots.push(join(input.out, 'confirmation.png'));
    await page.screenshot({ path: result.shots[0], fullPage: true });
    return { ...result, confirmed: thanked(done) };
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser?.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = await run(JSON.parse(await readFile(process.argv[2], 'utf8')));
  } catch (e) {
    result = { ok: false, url: '', fields: [], shots: [], error: e instanceof Error ? e.message : String(e) };
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}
