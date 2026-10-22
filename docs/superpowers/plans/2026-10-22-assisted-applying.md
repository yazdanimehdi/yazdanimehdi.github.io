# Assisted applying and nightly automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project 3 of the job-search roadmap. A headless browser pre-fills real application forms and stops before
Submit. The owner approves each application, and only then is it submitted with exactly the approved values. A nightly
run goes as far as the owner chooses (search, score, tailor, pre-fill). The owner is notified on the dashboard and by
an email digest. Drafting can run on an agent CLI with a subscription instead of an API key.

**Architecture:** A deterministic Playwright script (`runner.mjs`, no AI inside the browser) runs in a Vercel Sandbox
in three modes: `read` (list the form's fields and spot blockers), `fill` (fill, upload, screenshot, stop before
Submit) and `submit` (re-read, refuse if the form changed, fill the approved values, submit, screenshot). The server
decides values: the CV and Application answers first, the AI only for the rest, and a handoff whenever it isn't sure.
Workflow SDK workflows chain these as resumable steps. One apply sandbox runs at a time.

**Tech Stack:** Astro 7 + Vue 3 admin, Postgres (pglite in tests), Workflow SDK 5.2.3 (`'use workflow'` / `'use step'`),
`@vercel/sandbox` 3.7.0, Playwright inside the VM (installed there, not a site dependency), Resend over `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-20-cv-styles-and-job-search-design.md`, section "Project 3: assisted applying
and automation" (lines 213-290). The admin layout it lands in is `docs/superpowers/specs/2026-10-22-admin-ux-design.md`.

## Global Constraints

- Submission is never automatic and never a nightly stage. Only an approval (single or "Approve all ready", which
  approves each posting individually) submits.
- Submission uses exactly the approved values. If the live form's fields differ from the approved ones (added,
  removed, relabelled, a new required field, changed options), stop with state `changed` and ask again.
- Captcha, login or account creation, or a value the server isn't confident about → hand off: state `handoff`, a
  reason, a link and all prepared materials. Never improvise.
- Nightly stages: 1 search only, 2 + score, 3 + tailor CV and cover letter for matches at or above the threshold, 4 +
  pre-fill and mark "ready for approval". **Default 3.** Each stage includes the earlier ones.
- Limits: max drafts per night (default 5), max applications per company in a window (default 2 per 30 days), and a
  master pause switch.
- Notifications: a dashboard badge and a "Ready for approval" list, always on. An email digest via Resend, key on
  the Integrations → Keys list, can be switched off (default off until a key and an address exist).
- Quota exhausted on a subscription worker → the run stops and reports it. **Never fall back to paid API usage.**
- Subscription tokens and keys are sealed in `secrets` (`src/lib/admin/secrets.ts`), never in documents or the backup.
  Agents see only the secrets their task needs.
- Posting text is untrusted everywhere: AI prompts use the existing `UNTRUSTED` framing (`src/lib/career/prompts.ts`),
  the job page escapes it, and the browser runner is plain code that takes no instructions from the page.
- Every step is safe to re-run. A submit step is `maxRetries = 0` and never re-submits a posting whose state is
  already `submitting` or `submitted`.
- Postgres mode and the owner only (`careerRoute`), like the rest of the job search.
- During development, never submit to a real employer. Submit-mode tests run only against local fixture forms.

## Review Focus

1. **A second submission.** A retried step, a double click or "Approve all" while one submit runs must never post an
   application twice. Pinned in Task 4 (`submit refuses a posting already submitting or submitted`).
2. **A form that changed between fill and approval** (new required question, different options). It must stop, not
   fill around it. Pinned in Task 2 (`submit stops when a required field was added`) and Task 4.
3. **A page that isn't a form** (expired posting, 404, a careers landing page with an "Apply" button). The runner
   clicks one Apply link at most, then reports `no-form` as a handoff. Pinned in Task 2.
4. **Quota or provider errors in the night.** The run must say why it stopped, not report "0 drafted". Pinned in
   Task 5 (`a quota error stops the night and is reported`) and Task 7.
5. **The digest with nothing to say, or no key.** No email is sent, and nothing fails. Pinned in Task 5.

---

## File Structure

- `migrations/006_apply.sql`: posting columns `application jsonb`, `apply_run_id text`; settings column
  `apply_queue_run_id text`.
- `src/lib/career/apply/types.ts`: `ApplyField`, `Application`, `ApplyState`, `RunnerInput`, `RunnerResult`.
- `src/lib/career/apply/runner.mjs`: the browser script (plain ESM, runs under Node in the VM and in local tests).
- `src/lib/career/apply/values.ts`: field values from the CV, Application answers and the AI.
- `src/lib/career/apply/sandbox.ts`: runs `runner.mjs` in the apply sandbox and moves files in and out.
- `src/lib/career/apply/steps.ts`: `'use step'` functions for pre-fill and submit.
- `src/workflows/career-apply.ts`: `careerPrefill(id)` and `careerSubmitQueue()` workflows plus their start functions.
- `src/lib/career/nightly.ts`: stage, limit and company-window logic (pure) used by `career-nightly.ts`.
- `src/lib/career/digest.ts`: the digest text and the Resend call.
- `src/lib/career/worker.ts`: the drafting worker (API or agent CLI in a Sandbox).
- Routes: `src/admin/routes/api/career/postings/[id]/apply.ts`, `src/admin/routes/api/career/approve-all.ts`.
- UI: `src/admin/CareerJob.vue` (Application section), `src/admin/Career.vue` (Ready for approval tab),
  `src/admin/CareerSettings.vue` (Automation and Drafting worker sections), `src/admin/Ai.vue` (keys), Dashboard row.
- Tests: next to each file (`*.test.ts`), fixtures in `tests/fixtures/career/forms/*.html`.

---

### Task 1: Data model, preferences and secrets

**Files:**
- Create: `migrations/006_apply.sql`, `src/lib/career/apply/types.ts`
- Modify: `src/lib/career/db.ts` (Patch, getPosting, new helpers), `src/lib/career/types.ts` (Posting gains
  `application`), `src/lib/career/settings.ts` (prefs schema), `src/lib/admin/secrets.ts` (SECRETS)
- Test: `src/lib/career/db.test.ts`, `src/lib/career/settings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ApplyKind = 'text'|'email'|'tel'|'url'|'number'|'date'|'textarea'|'select'|'radio'|'checkbox'|'file';
  interface ApplyField { id: string; label: string; kind: ApplyKind; required: boolean; options?: string[];
    value: string; source: 'cv'|'answers'|'ai'|'handoff'|'file'|'owner'; note?: string }
  type ApplyState = 'prefilling'|'ready'|'handoff'|'approved'|'submitting'|'submitted'|'unconfirmed'|'changed'|'failed';
  interface Application { state: ApplyState; at: string; url: string; fields: ApplyField[]; shots: string[];
    letterPdf?: string; reason?: string; approved?: { at: string; by: string; fields: ApplyField[] };
    confirmation?: string }
  // db.ts
  Patch.application?: Application | null; Patch.applyRunId?: string | null;
  function readyPostings(sql: Sql): Promise<PostingSummary[]>;        // status 'ready', newest first
  function approvedPostings(sql: Sql): Promise<number[]>;             // application.state = 'approved', oldest approval first
  function companyApplications(sql: Sql, company: string, sinceIso: string): Promise<number>;
      // postings of that company (case-insensitive, trimmed) with status in drafted|ready|submitted|interview|offer
      // whose found_at or a 'status' event is on/after sinceIso
  // settings.ts: CareerPrefs gains
  nightly: { stage: 1|2|3|4 /*default 3*/; maxDrafts: number /*5, 0..50*/; perCompany: { max: number /*2*/; days: number /*30*/ }; paused: boolean /*false*/ };
  digest: { on: boolean /*false*/; to: string /*''*/; from: string /*''*/ };
  worker: { kind: 'api' } | { kind: 'cli'; agent: 'claude'|'codex'|'gemini'; auth: 'key'|'subscription' }; // default { kind: 'api' }
  // secrets.ts SECRETS gains: RESEND_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, CODEX_AUTH_JSON (CAREER_SECRETS too)
  ```

- [ ] **Step 1: Write failing tests.** `db.test.ts`: `application round-trips through updatePosting and getPosting`
  (write an Application, read the same object back; `null` clears it); `readyPostings lists only status ready`;
  `companyApplications counts the same company case-insensitively inside the window only` (3 postings: "Uber", "uber "
  drafted 10 days ago, "Uber" submitted 40 days ago; window 30 days → 2). `settings.test.ts`: `parsePrefs fills the
  nightly defaults` (`stage 3, maxDrafts 5, perCompany {2, 30}, paused false`), `validatePrefs rejects stage 5`,
  `parsePrefs keeps worker api by default`.
- [ ] **Step 2: Run** `pnpm test` → the new tests fail.
- [ ] **Step 3: Implement.** Migration adds the three columns (nullable). Follow db.ts's `${text}::text::jsonb` pattern.
  Prefs fields use the existing `field(l, …)` pattern so lenient parsing defaults them and strict validation bounds them.
- [ ] **Step 4: Run** `pnpm test` → all pass. `pnpm check` clean.
- [ ] **Step 5: Commit** "Career: data for applications, nightly stages, digest and worker".

### Task 2: The browser runner

**Files:**
- Create: `src/lib/career/apply/runner.mjs`, `tests/fixtures/career/forms/{greenhouse,lever,captcha,login,landing,changed}.html`
- Test: `src/lib/career/apply/runner.test.ts`

**Interfaces:**
- Produces (`runner.mjs`, ESM, imports `playwright` dynamically so local tests can pass `@playwright/test`'s chromium):
  ```ts
  interface RunnerInput { mode: 'read'|'fill'|'submit'; url: string;
    values?: { id: string; value: string }[];          // fill, submit
    expect?: ApplyField[];                              // submit: the approved fields to compare against
    files?: { cv?: string; letter?: string };           // absolute paths in the VM (or locally)
    letterHtml?: string;                                // fill: rendered to letter.pdf with page.pdf() when given
    out: string }                                       // folder for screenshots and letter.pdf
  interface RunnerResult { ok: boolean; url: string; fields: ApplyField[];
    blocker?: 'captcha'|'login'|'account'|'no-form'; changed?: string[];   // ids that differ
    shots: string[]; letterPdf?: string; confirmed?: boolean; error?: string }
  export async function run(input: RunnerInput, chromium?: BrowserType): Promise<RunnerResult>;
  // CLI: `node runner.mjs <input.json>` prints one JSON RunnerResult line on stdout.
  ```
- Field ids: `name` attribute, else `id`, else `label:<normalised label text>`. Labels come from `<label for>`, a
  wrapping label, `aria-label`, `aria-labelledby`, or the nearest legend for radio groups. Hidden and disabled inputs
  are skipped. A radio group is one field whose options are its labels.
- Blockers: an iframe or script from `recaptcha`, `hcaptcha` or `challenges.cloudflare.com` → `captcha`; a visible
  password input → `login`; a "create account" / "sign up" heading → `account`; no visible form field after at most one
  click on a link or button whose text matches `/^\s*apply( now| for this job)?\s*$/i` → `no-form`.
- Fill never clicks Submit. Submit compares `fields` to `expect` on (id, label, kind, required, options) before typing
  anything, then fills, reads the values back, clicks the one submit control (`button[type=submit]`, `input[type=submit]`,
  or a button whose text matches `/^\s*submit( application)?\s*$/i`), waits for navigation or network idle (15 s), and
  sets `confirmed` when the page now says `/thank|received|submitted|application (has been|was) sent/i` or the form
  is gone. Screenshots are full-page PNGs: `filled-1.png` (fill) or `confirmation.png` (submit).

- [ ] **Step 1: Write the fixtures.** Plain HTML that posts to a same-page `#thanks` handler (a tiny inline script shows
  "Thank you, your application was received" and removes the form). `greenhouse.html`: first/last name, email, phone,
  resume file, cover letter file, a required select "Are you authorized to work in the US?", an optional textarea
  "Why us?", a radio group "Will you require sponsorship?". `lever.html`: name, email, a URL "LinkedIn", resume file,
  checkbox "I agree to the privacy policy" (required). `captcha.html`: greenhouse.html plus
  `<script src="https://www.google.com/recaptcha/api.js">` (blocked from loading in tests: route it to an empty body).
  `login.html`: email + password. `landing.html`: no form, an "Apply now" link to `greenhouse.html`. `changed.html`:
  greenhouse.html plus a required text field "Earliest start date".
- [ ] **Step 2: Write failing tests** (serve the folder with `node:http` on a random port; launch `chromium` from
  `@playwright/test`; skip the file with a clear message if the browser isn't installed):
  `read lists greenhouse fields with labels, kinds, required and options`;
  `read follows one Apply link from a landing page`;
  `read reports captcha / login as blockers`;
  `fill fills values, uploads files, writes a screenshot and never submits` (assert the form still exists and no
  `#thanks` text);
  `fill renders letterHtml to letter.pdf and uploads it to the cover-letter field`;
  `submit stops when a required field was added` (expect = greenhouse fields, url = changed.html → `ok false`,
  `changed` contains `label:earliest start date` or its name, form not submitted);
  `submit fills the approved values, submits and confirms` (`confirmed true`, `confirmation.png` exists);
  `the CLI prints one JSON line`.
- [ ] **Step 3: Run** `pnpm test` → the new tests fail.
- [ ] **Step 4: Implement `run()`** in `runner.mjs`. Keep it dependency-free apart from Playwright.
- [ ] **Step 5: Run** `pnpm test` → pass. `pnpm lint` clean (add the `.mjs` to ESLint's Node globals if needed).
- [ ] **Step 6: Commit** "Career: a browser runner that reads, fills and submits application forms".

### Task 3: Field values

**Files:**
- Create: `src/lib/career/apply/values.ts`
- Modify: `src/lib/career/answers.ts` (export the pieces reused: known-answer matching, EEO handling, the prompt
  framing; don't duplicate them)
- Test: `src/lib/career/apply/values.test.ts`

**Interfaces:**
- Consumes: `ApplyField` (Task 1), `cvText`, `UNTRUSTED`, `jsonObject` (existing), `generateText` via the worker
  (Task 7 swaps the backend; here call the existing `generateText(store, config, input)`).
- Produces:
  ```ts
  function knownValues(fields: ApplyField[], cv: CvConfig, answers: ApplicationAnswers): ApplyField[];
      // fills what the CV/answers know (name, email, phone, links, work authorization, sponsorship, notice, start,
      // salary, address, EEO per answers.eeo.mode), marks file fields source 'file', leaves the rest value ''
  function valuesPrompt(fields: ApplyField[], posting: Posting, cv: CvConfig, letter: string): TextInput;
  function parseValues(reply: string, fields: ApplyField[]): ApplyField[];
      // AI answers only for ids it was asked about; a value must be one of `options` when options exist;
      // { "id": …, "value": …, "confident": false } or a missing id → source 'handoff' with a note
  function needsHandoff(fields: ApplyField[]): string | null;
      // a required field with source 'handoff' or an empty value → "Needs your answer: <label>"
  ```
- [ ] **Step 1: Write failing tests:** `knownValues fills name, email and phone from the CV`;
  `knownValues answers sponsorship from Application answers` (radio option "No" when `sponsorship: 'no'`);
  `EEO fields decline when eeo.mode is decline` (choose the option matching `/decline|prefer not/i`);
  `parseValues rejects a value outside the options` (→ handoff);
  `parseValues ignores ids it wasn't asked about` (a reply that sets `email` doesn't override the CV value);
  `needsHandoff names the first required unanswered field`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** "Career: values for application form fields, with a handoff when unsure".

### Task 4: Pre-fill, approval and submission

**Files:**
- Create: `src/lib/career/apply/sandbox.ts`, `src/lib/career/apply/steps.ts`, `src/workflows/career-apply.ts`,
  `src/admin/routes/api/career/postings/[id]/apply.ts`, `src/admin/routes/api/career/approve-all.ts`
- Modify: `src/lib/career/files.ts` (`putCareerFile(postingId, name, bytes, type): Promise<string>`, Blob path
  `career/<id>/<name>`, random suffix like `putCareerPdf`), `src/admin/routes/[...path].astro` is unaffected (API routes
  are file-routed; follow how the existing career routes are registered).
- Test: `src/lib/career/apply/steps.test.ts`, `src/workflows/career-apply.test.ts`, `src/lib/career/apply-route.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3; `SandboxApi`/`vercelSandbox` and `setSandboxForTests` from `src/lib/admin/sandbox.ts`.
- Produces:
  ```ts
  // sandbox.ts
  function runInApplySandbox(input: Omit<RunnerInput,'out'|'files'> & { cvPdfUrl?: string; letterText?: string }):
    Promise<RunnerResult & { files: Record<string, Uint8Array> }>;
      // sandbox name 'scholaros-apply' (persistent, reused): first boot installs playwright + chromium
      // (`npm i -g playwright@<pinned> && npx playwright install --with-deps chromium`, sudo) and records a marker file;
      // network policy allow-all with NO secrets in env; writes runner.mjs (loaded with `await import('./runner.mjs?raw')`),
      // input.json, cv.pdf (downloaded server-side from cvPdfUrl), runs `node runner.mjs input.json` (timeout 240 s),
      // reads back the PNG/PDF files it names, then stops the session.
  // steps.ts ('use step'; submitStep has maxRetries = 0)
  prefillStep(id: number): Promise<Application>   // read → values (Task 3) → fill → Blob → state ready|handoff|failed
  submitStep(id: number): Promise<Application>    // approved → submitting → submit → submitted|unconfirmed|changed|failed
  // career-apply.ts
  careerPrefill(id: number): Promise<void>        // 'use workflow'
  careerSubmitQueue(): Promise<number>            // 'use workflow'; drains approvedPostings() one at a time
  startPrefill(sql, id, runs?): Promise<{ runId: string } | 'running' | 'no-draft' | 'busy'>
  approve(sql, id, fields: ApplyField[], by: string): Promise<'ok' | 'not-ready' | 'changed-values'>
      // only from state ready; values must match the listed field ids exactly; stores application.approved
      // and state 'approved'; then ensureSubmitQueue()
  ensureSubmitQueue(sql, runs?): Promise<void>    // starts careerSubmitQueue unless settings.apply_queue_run_id runs
  ```
- Status changes: prefill → `ready` (status) only when state is `ready`; submit → `submitted` only when `confirmed`.
  Each transition adds a `career_events` row (`kind: 'apply'`, detail = state and reason).
- Routes: `POST postings/[id]/apply` body `{ action: 'prefill' }` → startPrefill; `{ action: 'approve', fields }` →
  approve; `{ action: 'skip' }` → status `skipped`, application kept; `{ action: 'handoff' }` → state `handoff`
  ("You chose to finish this one yourself"). `POST career/approve-all` approves every `ready` posting with its current
  fields, one `approve()` call each, and returns `{ approved: number[], skipped: { id, reason }[] }`.
- [ ] **Step 1: Write failing tests** with a fake `SandboxApi` that returns canned `RunnerResult`s:
  `prefill moves a drafted posting to ready with fields and screenshots`;
  `prefill hands off on a captcha and keeps status drafted`;
  `prefill refuses a posting with no tailored CV` (`no-draft`);
  `approve rejects values for ids the form doesn't have`;
  `approve-all approves each ready posting individually and reports the rest`;
  `submit refuses a posting already submitting or submitted` (no sandbox call);
  `submit stops with state changed when the runner reports changed fields`, status stays `ready`;
  `submit sets status submitted only when confirmed` (unconfirmed → status stays `ready`, state `unconfirmed`);
  `only one apply sandbox runs at a time` (`startPrefill` → `busy` while another posting is `prefilling` < 15 min old);
  route tests: non-owner → 404; `approve` with a stale field set → 409.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Verify the real Sandbox once, against a fixture, never an employer.** With `VERCEL_OIDC_TOKEN` in the
  environment (`vercel env pull` from a linked checkout), run a scratch script that calls `runInApplySandbox` in `read`
  then `fill` mode on `file:///vercel/sandbox/greenhouse.html` (write the fixture into the VM first). Expected: fields
  listed, `filled-1.png` returned. If no OIDC token is available, record that this step is outstanding in the report.
- [ ] **Step 6:** `pnpm build` (Postgres mode env) succeeds and the built server bundle contains the runner source
  (`grep -r "RunnerResult\|no-form" dist/ .vercel/output/ | head`), proving the `?raw` import was bundled.
- [ ] **Step 7: Commit** "Career: pre-fill applications in a Sandbox and submit only what was approved".

### Task 5: Nightly stages, limits, pause and the digest

**Files:**
- Create: `src/lib/career/nightly.ts`, `src/lib/career/digest.ts`
- Modify: `src/workflows/career-nightly.ts`, `src/lib/career/steps.ts` (new steps), `src/lib/career/types.ts`
  (`RunSummary` gains `paused?`, `stage`, `drafted`, `prefilled`, `handedOff`, `limited`, `stopped?: string`,
  `digest?: 'sent'|'skipped'|string`)
- Test: `src/lib/career/nightly.test.ts`, `src/lib/career/digest.test.ts`, `src/workflows/career-nightly.test.ts`

**Interfaces:**
- Consumes: `careerDraft`'s steps (extract the body of `careerDraft` into `draftPosting(id, part, instruction, greenhouse)`,
  a plain async function both workflows call, so the nightly run reuses it without nesting workflows), `prefillStep`.
- Produces:
  ```ts
  function draftCandidates(matches: PostingSummary[], prefs: CareerPrefs, counts: Map<string, number>): { ids: number[]; limited: number };
      // matches ≥ threshold, status found, draftState none; company count + already chosen tonight < perCompany.max;
      // at most nightly.maxDrafts
  function digestText(summary: RunSummary, ready: PostingSummary[], drafted: PostingSummary[], adminUrl: string): { subject: string; text: string; html: string } | null;
      // null when there is nothing new
  async function sendDigest(sql: Sql, summary: RunSummary, fetchFn?): Promise<'sent'|'skipped'|string>;
      // 'skipped': off, no key, no address or nothing new; a string: Resend's error message. Never throws.
  ```
- Behaviour: `paused` → the run records `paused: true` and does nothing else. Stage 1 gathers only; 2 scores; 3
  drafts the candidates (sequentially); 4 pre-fills each one that drafted cleanly. A `QuotaError` (Task 7) or a
  provider error on drafting stops the drafting loop and sets `stopped`. The digest is sent last.
  Resend: `POST https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>`, body
  `{ from, to: [to], subject, text, html }`; `from` defaults to `ScholarOS <onboarding@resend.dev>` and the admin says
  that address only delivers to the Resend account's own email until a domain is verified.
- [ ] **Step 1: Write failing tests:** `paused does nothing`; `stage 1 gathers without scoring`; `stage 3 drafts at most
  maxDrafts matches`; `the company window holds back a third Uber posting`; `stage 4 pre-fills what drafted`;
  `a quota error stops the night and is reported` (`stopped` set, later candidates untouched);
  `digest is skipped with nothing new, with no key, and when off`; `digest posts the ready list to Resend`
  (fake fetch asserts URL, auth header and that every ready posting's title and admin link appear);
  `a Resend error is recorded, not thrown`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. Also fix the parked finding "run summary
  hides AI provider errors": when every score is deferred, `scoreError` carries the first provider message (existing
  test `career-nightly.test.ts` gains `all deferred keeps the reason`).
- [ ] **Step 5: Commit** "Career: nightly stages up to pre-fill, limits, pause and an email digest".

### Task 6: Admin screens

**Files:**
- Modify: `src/admin/CareerJob.vue` (Application section), `src/admin/Career.vue` (Ready for approval tab, Approve all
  ready), `src/admin/CareerSettings.vue` (Automation section: stage, limits, pause; Notifications: digest on, to,
  from), `src/admin/Ai.vue` (RESEND_API_KEY on the Keys list), `src/admin/routes/api/me.ts` (adds
  `career: { ready: number }` for the owner in Postgres mode), `src/admin/AdminShell.vue` (fills the Job search badge
  from `me`), `src/admin/routes/api/dashboard.ts` + `src/admin/Dashboard.vue` (a "Job search" row: "N ready for
  approval", linking to the Ready tab, owner only)
- Test: `src/lib/career/postings-route.test.ts` (me/dashboard payloads), e2e unaffected (memory store has no career)

**Interfaces:**
- Consumes: Task 4 routes; `Application` type.
- Application section on the job page (by state):
  - none: "Pre-fill the application" (Primary when the CV draft is done), with one line on what it does and that
    nothing is sent.
  - `prefilling`: progress line, polling like the draft section.
  - `ready`: the screenshots (click to open full size in a new tab), then a ruled list of fields: label, required
    mark, value (editable input; a select for fields with options), source chip (CV, Answers, AI, You). Buttons:
    **Approve and submit** (Primary; a confirm dialog listing the form's host and the number of fields, Cancel focused
    first per DESIGN.md's destructive-confirm rule), Skip, Finish it myself.
  - `handoff`: "Finish this one yourself" with the reason, the form link, the tailored CV PDF, the letter (text and
    PDF), and each field's prepared value with a Copy button.
  - `approved`/`submitting`: "Submitting…" polling. `submitted`: the confirmation screenshot and time.
    `unconfirmed`: "Submitted, but the site didn't confirm it. Check your email or the employer's portal." with the
    screenshot, plus "Mark as submitted". `changed`: what changed, and "Pre-fill again". `failed`: the reason and Retry.
- Ready for approval tab: ruled rows (company, title, score, pre-filled date, field count, "Review →"); an
  **Approve all ready** button that opens a confirm listing every posting by company and title, then calls
  `approve-all` and toasts the result.
- [ ] **Step 1:** Implement the screens.
- [ ] **Step 2:** Verify in the browser against the local Postgres dev server with seeded postings in each state
  (insert rows with SQL; never run a real pre-fill locally against an employer). Screenshot each state at 1440 and
  390 wide; fix what's off in one round.
- [ ] **Step 3:** `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm test:e2e` pass.
- [ ] **Step 4: Commit** "Admin: review, approve and hand off applications; automation settings".

### Task 7: Drafting worker (agent CLIs) and quota handling

**Files:**
- Create: `src/lib/career/worker.ts`
- Modify: `src/lib/career/steps.ts` (draft, review and answers calls go through the worker; scoring stays on the API),
  `src/lib/career/apply/values.ts` (its AI call goes through the worker), `src/admin/CareerSettings.vue` (Drafting
  worker section), `src/admin/Ai.vue` (CLAUDE_CODE_OAUTH_TOKEN and CODEX_AUTH_JSON on Keys, owner + Postgres only, the
  Codex one as a textarea for the auth.json contents)
- Test: `src/lib/career/worker.test.ts`

**Interfaces:**
- Consumes: `AGENTS` and the brokered network policy pattern from `src/lib/admin/editor.ts` (reuse; don't copy),
  `SandboxApi`.
- Produces:
  ```ts
  class QuotaError extends Error {}
  function workerText(store: ContentStore, prefs: CareerPrefs, input: TextInput): Promise<string>;
      // api → generateText(store, readAiConfig(store), input)
      // cli → sandbox 'scholaros-worker' (non-persistent, timeout 5 min): prompt written to a file, run
      //   claude: `claude -p "$(cat prompt.txt)" --output-format json` (no tools), read `.result`
      //   codex:  `codex exec --skip-git-repo-check -o last.txt "$(cat prompt.txt)"`, read last.txt
      //   gemini: `gemini -p "$(cat prompt.txt)"` (the Antigravity slot, see below)
      // auth key → the editor's brokered header for that provider (PLACEHOLDER in env)
      // auth subscription:
      //   claude → CLAUDE_CODE_OAUTH_TOKEN=PLACEHOLDER in env, allow api.anthropic.com with the real
      //            `authorization: Bearer <token>` injected by the firewall
      //   codex  → ~/.codex/auth.json written into the VM for this run only (Codex refreshes it in place; read it back
      //            afterwards and re-seal it when it changed); egress allow-list: api.openai.com, chatgpt.com,
      //            auth.openai.com
      // output or exit text matching /usage limit|rate limit|quota|insufficient credits|limit reached/i → QuotaError
  ```
- Antigravity: Google's `agy` CLI has a print mode (`agy -p`), but headless sign-in is an interactive URL + code flow
  and its flags were not verifiable here. Per the spec's fallback, the third slot is **Gemini CLI with a Gemini API key**
  (already used by the Site editor), and the admin says so: "Antigravity has no sign-in that works unattended yet, so
  this slot runs Gemini CLI with your Gemini API key."
- The Codex auth file entering the VM is a deliberate exception to "secrets only through the network policy": Codex
  reads and refreshes a file, so the header can't be brokered. The VM is non-persistent and its egress is limited to
  OpenAI's hosts. The admin's Codex key row says this in one line.
- [ ] **Step 1: Write failing tests** (fake SandboxApi): `api worker calls generateText`;
  `claude subscription keeps the token out of the VM env` (env has PLACEHOLDER; the policy carries the Bearer header);
  `codex subscription writes auth.json and re-seals a refreshed one`; `quota text raises QuotaError`;
  `a QuotaError never falls back to the API` (generateText not called).
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit** "Career: draft with
  an agent CLI on a subscription; stop on quota".

### Task 8: Docs and the end-to-end check

**Files:** `README.md` (Job search section: applying, nightly stages, digest, worker), `DESIGN.md` (Admin: the
Application section, Ready tab, badge), `docs/superpowers/specs/2026-10-20-cv-styles-and-job-search-design.md` (a
"Built" note under Project 3 naming the Antigravity and Codex decisions).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Full verification: `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm test:e2e`, `pnpm build`.
- [ ] **Step 3: Commit** "Docs: assisted applying and nightly automation".
