# Better Tailoring and Suggested Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tailored CVs that visibly answer the posting (its required and preferred qualifications mapped to CV evidence, its terms used where the CV backs them, relevance-first selection from any section, skills reordered, papers chosen by relevance from the whole publications collection, at most two pages), job-search settings pre-filled from the site, and the defects the 2026-10-21 preview run found.

**Architecture:** The drafter's one AI call grows a `requirements` list and may set a skills entry's `details`; `assembleCv` keeps enforcing "nothing outside the CV" in code (a `details` keeps only items of that line). `baseCv` swaps the CV's publication section for the full collection, and the prompt shows each paper's abstract. Coverage (is each requirement's term in the tailored CV, in the base CV, or neither?) is computed in code, never by the AI, and shown as shown / cut / worded differently / gap, following ai-job-search's four-way keyword table and Workday HiredScore's per-qualification Fit & Gap view. A new owner-only route suggests prefs from the CV and publications (one AI call) plus contact answers copied from the CV (no AI); the settings screen fills an empty form with it, unsaved.

**Tech Stack:** Astro 7.4 + Vue 3 admin, TypeScript, `node:test` via `tsx --test`, Workflow SDK 5.2.3, postgres.js / PGlite in tests.

**Spec:** `docs/superpowers/specs/2026-10-20-cv-styles-and-job-search-design.md` (project 2), plus the owner's review of the preview draft on 2026-10-21: "the resume is not tailored, no keyword selected from the job description is there, the papers are not well aligned"; "the job settings should be pre-populated with the site contents automatically using AI"; papers by "relevance to the job from the full publication page, not just selected papers".

## Global Constraints

- No fabrication: the AI may only select, reorder, condense and reword what is in the CV and Application answers. Code (`assembleCv`) enforces it; the reviewer pass stays.
- Posting text is untrusted: it only ever reaches a prompt through `posting()` from `prompts.ts`; model output is data, shown through `visible()` and never `v-html`.
- Owner only, Postgres mode only: every new route uses `careerRoute` (404 for anyone else and outside Postgres).
- Suggestions are proposals: nothing the AI suggests is saved until the owner presses Save.
- AI-call ceiling per draft stays 7; the suggest route makes at most 1 AI call per request.
- jsonb writes use `${JSON.stringify(v)}::text::jsonb`.
- Run all checks before each commit: `npm test`, `npm run check` (0 errors), `npm run lint`.

## Review Focus

1. A CV whose publication section lists papers that are not in the collection (preprints, talks): they must stay selectable, not vanish. Test in Task 4.
2. A skills line that is one phrase, not a list ("Fluent in Farsi and English"): `details` may only keep it whole; reordering a one-item line is a no-op, not an error. Test in Task 5.
3. A posting with no description (LinkedIn guest search): the draft still works, `requirements` may be empty, and the panel says there were none to check. Test in Task 6.
4. Paper titles that differ between the CV and the collection only in case or punctuation: treated as the same paper, listed once. Test in Task 4.
5. Suggest with no CV, or a model reply with junk or oversized lists: a clear 400 message, or capped lists that pass `validatePrefs`; the form is never half-filled with invalid values. Tests in Task 8.

---

### Task 1: Line separators become line breaks, not glue

The preview showed "About the Role of ScienceEnd-to-end": `cleanText` in `guard.ts` deletes U+2028/U+2029, and `visible()` in `text.ts` does the same in one-line fields.

**Files:**
- Modify: `src/lib/career/guard.ts` (`cleanText`)
- Modify: `src/lib/career/text.ts` (`visible`)
- Test: `src/lib/career/guard.test.ts`, `src/admin/career.test.ts` (or wherever `visible` is tested; add to `guard.test.ts` if none)

**Interfaces:**
- Produces: `visible(s: string): string` now maps U+2028/U+2029 to a space; still drops every `\p{Cf}`.

- [ ] **Step 1: Write the failing tests**

```ts
test('line and paragraph separators become line breaks, still counted', () => {
  const g = guardPosting('About the Role of Science End-to-end work Next', 'text');
  assert.equal(g.text, 'About the Role of Science\nEnd-to-end work\n\nNext');
  assert.equal(g.flags.invisible.format, 2);
});
test('visible turns a separator into a space', () => {
  assert.equal(visible('Data Scientist​'), 'Data Scientist');
});
```

- [ ] **Step 2: Run them to see them fail** — `npx tsx --test src/lib/career/guard.test.ts` → FAIL (`ScienceEnd`).
- [ ] **Step 3: Implement** — in `cleanText`, map ` ` → `\n` and ` ` → `\n\n` before the invisible-character filter (counting is unchanged); in `visible`, replace `[  ]` with `' '` and keep dropping `\p{Cf}`.
- [ ] **Step 4: Run the tests** — PASS, and the full suite still passes.
- [ ] **Step 5: Commit** — `Career: line separators in postings become line breaks`

---

### Task 2: One Google Jobs posting, one key

The same Uber job arrived twice: Google Jobs results for one job can carry different first apply links, and `postingKey` hashes the URL.

**Files:**
- Modify: `src/lib/career/match.ts:35` (`postingKey`)
- Test: `src/lib/career/match.test.ts`

**Interfaces:**
- Produces: `postingKey(p: Pick<RawPosting, 'company' | 'title' | 'url' | 'location'> & { source?: string }): string`. For `source === 'google-jobs'` the third part is `fold(location ?? '')` instead of `normalizeUrl(url)`; every other source is unchanged (existing keys stay stable).

- [ ] **Step 1: Write the failing test**

```ts
test('google-jobs keys ignore the apply link, so one job found via two links is one posting', () => {
  const a = { source: 'google-jobs', company: 'Uber', title: 'Senior Scientist - Marketplace', location: 'New York, NY', url: 'https://a.test/1' };
  assert.equal(postingKey(a), postingKey({ ...a, url: 'https://b.test/2' }));
  assert.notEqual(postingKey(a), postingKey({ ...a, location: 'San Francisco, CA' }));
  const g = { source: 'greenhouse', company: 'Uber', title: 'X', location: 'NY', url: 'https://a.test/1' };
  assert.notEqual(postingKey(g), postingKey({ ...g, url: 'https://b.test/2' }), 'other sources still key on the URL');
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement** as in Interfaces; update the doc comment above `postingKey`.
- [ ] **Step 4: Run** `npx tsx --test src/lib/career/match.test.ts src/lib/career/steps.test.ts` — PASS.
- [ ] **Step 5: Commit** — `Career: Google Jobs postings key on company, title and location`

---

### Task 3: The run says why scoring failed; no "No run yet" flash

The preview's run with no API credit said only "scored 0 · 33 left for later".

**Files:**
- Modify: `src/lib/career/types.ts` (`RunSummary`)
- Modify: `src/workflows/career-nightly.ts`
- Modify: `src/admin/Career.vue`
- Test: `src/lib/career/steps.test.ts` (wherever `careerNightly` or its pieces are tested; else a new `src/workflows/career-nightly.test.ts` for the helper)

**Interfaces:**
- Produces: `RunSummary.scoreError?: string`: the first provider or network error of the night, at most 300 characters, set only when at least one posting was deferred by an error.
- Produces: `export function errorText(reason: unknown): string` in `src/workflows/career-nightly.ts`: the error's message (or `String(reason)`), with a leading `Step "<anything>" failed:` and a following `Error: ` stripped, trimmed, at most 300 characters.

- [ ] **Step 1: Write the failing tests**

```ts
test('errorText keeps the provider message and drops the step wrapper', () => {
  assert.equal(
    errorText(new Error('Step "step//./src/lib/career/steps//scorePosting" failed: Error: Anthropic answered 400: Your credit balance is too low')),
    'Anthropic answered 400: Your credit balance is too low',
  );
  assert.equal(errorText('boom'), 'boom');
  assert.equal(errorText(new Error('x'.repeat(400))).length, 300);
});
```

- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement** — `errorText` as specified; in `careerNightly`, `scoreError ??= errorText(r.reason)` on each rejected result, spread into the summary when set. In `Career.vue`, below the `scoreSkipped` line: `<p v-if="run.lastRun.scoreError" class="adm-err" role="status">` with the copy `Scoring hit an error: {{ visible(run.lastRun.scoreError) }}. Those postings wait for the next run.`; add a `loaded` ref set after the first status fetch and show the "No run yet" text only when `loaded && !run.lastRun`.
- [ ] **Step 4: Run** the tests and `npm run check` — PASS, 0 errors.
- [ ] **Step 5: Commit** — `Career: the run summary shows the AI error that stopped scoring`

---

### Task 4: Papers come from the whole publications collection, with abstracts in the prompt

Today `baseCv` adds the collection only when the CV has no publication section, and the drafter sees titles only.

**Files:**
- Modify: `src/lib/career/tailor.ts` (`baseCv`, `publicationEntries`, `numbered`, `draftPrompt`)
- Modify: `src/lib/career/steps.ts` (`draftStep` passes abstracts)
- Test: `src/lib/career/tailor.test.ts`

**Interfaces:**
- Produces: `baseCv(store)` (same signature): the first section whose first entry is a publication (`isPublication`) holds the **pool**, in its place and under its title; with no such section, a `publications` section is appended as today. The pool is every collection paper (`publicationEntries`, newest first) followed by the CV's own publication entries whose `fold(title)` matches no collection paper. Any further publication sections are removed (`// ponytail:` note: one pooled section; split by type if an owner asks).
- Produces: `export async function paperAbstracts(store: ContentStore): Promise<Map<string, string>>`: `fold(title)` → the collection entry's `abstract`, trimmed to 400 characters; papers without an abstract are absent.
- Produces: `draftPrompt(cv, p, prefs, instruction?, issues?, abstracts?: Map<string, string>)`: `numbered()` adds `abstract` to each publication entry whose folded title is in the map (prompt only; never in the CV). `fold` is imported from `./match`.

- [ ] **Step 1: Write the failing tests** (use the fake store the existing `baseCv` tests use)

```ts
test('baseCv pools every collection paper into the CV's own publication section, keeping CV-only papers once', async () => {
  // CV section `selectedPublications` lists "A title." and "A preprint" (not in the collection);
  // the collection has "A Title" (2023) and "B Title" (2024).
  const cv = await baseCv(store);
  const titles = cv.cv.sections!.selectedPublications.map((e) => (e as { title: string }).title);
  assert.deepEqual(titles, ['B Title', 'A Title', 'A preprint']); // collection newest first, then CV-only
  assert.equal(cv.cv.sections!.publications, undefined, 'no second publications section');
});
test('draftPrompt shows abstracts for papers, and the assembled CV never carries them', async () => {
  const abstracts = await paperAbstracts(store);
  const prompt = draftPrompt(await baseCv(store), posting, answers, '', undefined, abstracts).prompt;
  assert.match(prompt, /"abstract": "Graph neural networks for/);
  const cv = assembleCv(await baseCv(store), { sections: [{ title: 'selectedPublications', entries: [{ ref: 0 }] }] });
  assert.equal(JSON.stringify(cv).includes('abstract'), false);
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** as in Interfaces; `draftStep` reads `paperAbstracts(store)` alongside `baseCv` and passes it. `renderStep`, `reviewStep`, `answersStep` and the PATCH route keep calling `baseCv` unchanged.
- [ ] **Step 4: Run** `npx tsx --test src/lib/career/tailor.test.ts src/lib/career/steps.test.ts src/lib/career/job-route.test.ts` — PASS (update fixtures whose expectations assumed the old "collection only when the CV has none" rule).
- [ ] **Step 5: Commit** — `Career: drafts pick papers from the whole collection, seeing abstracts`

---

### Task 5: Skills lines can be reordered and trimmed, never extended

**Files:**
- Modify: `src/lib/career/tailor.ts` (`TailorPlan`, `assembleCv`, `parseTailorPlan`, `draftPrompt` rules)
- Modify: `src/admin/routes/api/career/postings/[id].ts` (the `Plan` zod schema accepts `details`)
- Modify: `src/admin/CareerJob.vue` (editor: a `details` field for entries with string `details`; `savePlan` sends it)
- Test: `src/lib/career/tailor.test.ts`, `src/lib/career/job-route.test.ts`

**Interfaces:**
- Produces: plan entry `{ ref: number; highlights?: string[]; text?: string; details?: string }`.
- Produces: `assembleCv` rule for `details`: the base entry must have a string `details`; split both on `/\s*[,;]\s*/` (empty items dropped); every new item must equal an original item case-insensitively, with no repeats and at least one item; the entry's `details` becomes the new items joined with `', '`. Anything else throws `FabricationError` naming the entry (`skills entry 0 adds "Rust"`).
- `rewordedPairs` ignores `details` (code already proves it adds nothing).

- [ ] **Step 1: Write the failing tests**

```ts
const skills = { label: 'Programming Languages', details: 'Python, Dart, JavaScript, C++, SQL' };
test('details may reorder and trim a skills line', () => {
  const cv = assembleCv(base({ skills: [skills] }), { sections: [{ title: 'skills', entries: [{ ref: 0, details: 'SQL, python' }] }] });
  assert.equal((cv.cv.sections!.skills[0] as typeof skills).details, 'SQL, python');
});
test('details may not add, repeat or empty a skills line', () => {
  for (const details of ['SQL, Rust', 'SQL, SQL', ' , '])
    assert.throws(() => assembleCv(base({ skills: [skills] }), { sections: [{ title: 'skills', entries: [{ ref: 0, details }] }] }), FabricationError);
});
test('a one-phrase details line can only stay whole', () => {
  const one = { label: 'Languages', details: 'Fluent in Farsi and English' };
  assert.doesNotThrow(() => assembleCv(base({ skills: [one] }), { sections: [{ title: 'skills', entries: [{ ref: 0, details: 'fluent in farsi and english' }] }] }));
  assert.throws(() => assembleCv(base({ skills: [one] }), { sections: [{ title: 'skills', entries: [{ ref: 0, details: 'Farsi' }] }] }), FabricationError);
});
```

Route test: a PATCH with `details` that adds an item answers 400 with the `FabricationError` message.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** as in Interfaces. Prompt rule added to the CV rules: `For an entry with "details" (a list such as skills), you may give "details": the same items, reordered with the ones this job asks for first, and trimmed; never add an item.` Editor: an entry with string `details` shows a one-line input prefilled with the plan's or the CV's value.
- [ ] **Step 4: Run** the tests — PASS.
- [ ] **Step 5: Commit** — `Career: tailored CVs can reorder and trim skills lines`

---

### Task 6: The drafter maps the posting's requirements to the CV; coverage is computed in code

**Files:**
- Modify: `src/lib/career/tailor.ts` (`TailorPlan`, `draftPrompt`, `parseTailorPlan`, new `withCoverage`)
- Modify: `src/lib/career/steps.ts` (`draftStep` saves `{ sections, requirements }` through `withCoverage`)
- Modify: `src/admin/routes/api/career/postings/[id].ts` (PATCH keeps the stored `requirements` and recomputes coverage for the new sections)
- Test: `src/lib/career/tailor.test.ts`, `src/lib/career/steps.test.ts`, `src/lib/career/job-route.test.ts`

Research basis (2026-10-21): ai-job-search's `/apply` addresses "every requirement the posting states … matched or honestly gapped, never silently omitted", prefers "the posting's own term over a synonym wherever it is truthfully applicable", and sorts keywords as covered / synonym-only / missing-but-have-it / gap. Workday HiredScore (Aug 2026) grades candidates per basic vs preferred qualification with a recruiter "Fit & Gap" view; Greenhouse Talent Matching matches "exact and similar" keywords. Career-centre guidance: spell out an acronym once with its short form; don't stuff keywords; industry CVs for PhDs run up to 2 pages; publications by role (research roles: a relevant "selected" set; data-science/engineering roles: a few).

**Interfaces:**
- Produces: `export interface Requirement { term: string; kind: 'required' | 'preferred'; evidence: string | null; inCv?: boolean; inBase?: boolean; uses?: number }` and `TailorPlan.requirements: Requirement[]`.
- Produces: `parseTailorPlan` reads `requirements` (missing → `[]`): at most 15, `term` `visible()`-cleaned, trimmed, 1–80 characters (others dropped), `kind` `'preferred'` unless exactly `'required'`, `evidence` a string of at most 200 characters or `null`.
- Produces: `export function withCoverage(base: CvConfig, plan: TailorPlan): TailorPlan`. Text of a CV = `fold` of every string value in its `cv.sections`. Each requirement gets `inCv` (its folded term occurs in the tailored CV's text, i.e. `assembleCv(base, plan)`), `inBase` (it occurs in the base CV's text), and `uses` (how many times it occurs in the tailored text). The four states the panel shows follow from these: **in the CV** (`inCv`), **in your CV but cut from this one** (`!inCv && inBase`), **supported, worded differently** (`!inBase && evidence`), **gap** (`!inBase && !evidence`).
- Prompt changes (`draftPrompt` system lines, exact copy; replaces the current "keep it to one page" clause):
  - `First list the posting's key requirements (at most 15, in the posting's own short terms, e.g. "causal inference", "SQL", "A/B testing") as "requirements": "kind" is "required" for what the posting requires and "preferred" for nice-to-haves; "evidence" names the CV entry that supports it (e.g. "researchExperience 1") or is null when the CV does not. Every requirement is listed, met or not; never fill a gap.`
  - `Where an entry supports a requirement, use the posting's term for it (spell out an acronym once with its short form, e.g. "large language models (LLMs)") in that entry's highlights, the summary, or a skills line's order. Never use a term the CV does not support, and use no term more than three times.`
  - `Choose what to keep by relevance to this posting, from any section: an older entry that speaks to the posting beats a recent one that does not. Put evidence for the required items first. Order sections by what this job weighs (experience before education for industry roles).`
  - `Summary: name the role this posting is for, if the CV supports it, and lead with the strongest evidence for its requirements; keep it specific, two or three sentences. Never change a past job title.`
  - `Publications: keep the most relevant to this job, judged by title and abstract, most relevant first: 5 to 8 for a research role, 2 to 4 otherwise. Keep each one's authors and venue as they are.`
  - `Length: at most two pages.`
  - Letter rules become: `Letter rules: 250-350 words, first person, addressed to the company by name. Say early why this role and company, from what the posting says. Give two or three examples from the CV mapped to the posting's top requirements; don't restate the CV. If a required item is a gap, you may name it honestly as something to grow into from related CV work; never claim it. Use only the CV and the candidate's reason for looking; invent no facts about the company beyond what the posting says.`
  - Reply shape gains `"requirements":[{"term":string,"kind":"required"|"preferred","evidence":string|null}]` before `"sections"`.
- `part === 'letter'` drafts keep the stored `cv` (requirements included) untouched.
- Page check (the model can't see the rendered length): `export function pdfPages(pdf: Uint8Array): number` in `src/lib/career/files.ts` counts `/Type /Page` objects (not `/Pages`) in the PDF bytes; `renderStep` adds the event `long cv` with detail `The tailored CV runs to N pages; the aim is at most 2.` when `N > 2`, and still saves the PDF. Test: a two-page and a three-page fixture PDF produced by the existing cv-render test helpers, or minimal hand-written PDF bytes with two and three `/Type /Page` objects.

- [ ] **Step 1: Write the failing tests**

```ts
test('parseTailorPlan reads requirements, capped and cleaned', () => {
  const reqs = Array.from({ length: 20 }, (_, i) => ({ term: `t${i}​`, kind: i ? 'preferred' : 'required', evidence: i % 2 ? null : 'skills 0' }));
  const plan = parseTailorPlan(JSON.stringify({ requirements: [...reqs, { term: '', evidence: null }], sections: [], letter: 'x' }));
  assert.equal(plan.requirements.length, 15);
  assert.deepEqual(plan.requirements[0], { term: 't0', kind: 'required', evidence: 'skills 0' });
  assert.equal(parseTailorPlan('{"requirements":[{"term":"SQL","kind":"must","evidence":null}],"sections":[],"letter":"x"}').requirements[0].kind, 'preferred');
  assert.deepEqual(parseTailorPlan('{"sections":[],"letter":"x"}').requirements, []);
});
test('withCoverage tells shown, cut, worded-differently and gap apart, and counts uses', () => {
  const plan = withCoverage(base({ skills: [{ label: 'L', details: 'Python, SQL' }] }), {
    sections: [{ title: 'skills', entries: [{ ref: 0, details: 'SQL' }] }],
    requirements: [
      { term: 'sql', kind: 'required', evidence: 'skills 0' },
      { term: 'Python', kind: 'required', evidence: 'skills 0' },
      { term: 'deep learning', kind: 'preferred', evidence: 'skills 0' },
      { term: 'Causal inference', kind: 'required', evidence: null },
    ],
    letter: '',
  });
  assert.deepEqual(plan.requirements.map((r) => [r.inCv, r.inBase, r.uses]), [[true, true, 1], [false, true, 0], [false, false, 0], [false, false, 0]]);
});
```

Steps test: a draft whose fake model reply has `requirements` stores them on `posting.cv` with `inCv` set; a draft for a posting with an empty description and no requirements still finishes `done`. Route test: a PATCH of `cv` keeps the stored requirements and recomputes `inCv`.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the career tests — PASS.
- [ ] **Step 5: Commit** — `Career: drafts map the posting's requirements to the CV, coverage checked in code`

---

### Task 7: Requirements panel on the job page

**Files:**
- Modify: `src/admin/CareerJob.vue` (a "Posting requirements" block at the top of the Tailored CV card; `savePlan` sends the plan's `requirements` back unchanged)
- Modify: `src/admin/career.ts` (pure helper) and `src/admin/career.test.ts`

**Interfaces:**
- Consumes: `Requirement` from Task 6 (import the type from `../lib/career/tailor`).
- Produces: `export type CoverageState = 'shown' | 'cut' | 'reworded' | 'gap'` and `export function coverageState(r: Requirement): CoverageState` in `src/admin/career.ts`: `shown` when `inCv`, `cut` when `inBase`, `reworded` when `evidence`, else `gap`.
- Produces: `export function coverageLine(reqs: Requirement[]): string`: `'No requirements were listed for this posting.'` for none; else `` `Required: ${a} of ${b} shown` `` and, when there are preferred ones, `` ` · preferred: ${c} of ${d}` ``, then `` ` · ${g} not in your CV` `` when any are `gap`.

- [ ] **Step 1: Write the failing test**

```ts
const R = (term: string, kind: 'required' | 'preferred', evidence: string | null, inCv: boolean, inBase: boolean) => ({ term, kind, evidence, inCv, inBase, uses: inCv ? 1 : 0 });
test('coverageState and coverageLine', () => {
  assert.equal(coverageLine([]), 'No requirements were listed for this posting.');
  const reqs = [R('SQL', 'required', 'skills 0', true, true), R('Python', 'required', 'skills 0', false, true), R('A/B testing', 'required', 'researchExperience 1', false, false), R('Go', 'required', null, false, false), R('Spark', 'preferred', null, false, false)];
  assert.deepEqual(reqs.map(coverageState), ['shown', 'cut', 'reworded', 'gap', 'gap']);
  assert.equal(coverageLine(reqs), 'Required: 1 of 4 shown · preferred: 0 of 1 · 2 not in your CV');
  assert.equal(coverageLine(reqs.slice(0, 1)), 'Required: 1 of 1 shown');
});
```

- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement** the helpers and the panel: the line, then required rows before preferred, each the term and its state's copy — `shown`: `In the CV`; `cut`: `In your CV, not in this version` with a hint to restore it in the editor below; `reworded`: `Supported by <evidence>, in other words`; `gap`: `Not in your CV`. A row whose `uses > 3` adds `used ${uses} times; may read as stuffing`. All text through `visible()`; no `v-html`.
- [ ] **Step 4: Run** `npx tsx --test src/admin/career.test.ts` and `npm run check` — PASS.
- [ ] **Step 5: Commit** — `Career: the job page shows how the tailored CV covers the posting`

---

### Task 8: Settings suggested from the site

**Files:**
- Create: `src/lib/career/suggest.ts`
- Create: `src/admin/routes/api/career/suggest.ts`
- Modify: `src/admin/CareerSettings.vue`
- Modify: `README.md` (Job search section: suggested settings; the requirements panel; papers from the whole collection)
- Test: `src/lib/career/suggest.test.ts`, `src/lib/career/route.test.ts` (owner-only)

**Interfaces:**
- Produces: `export function suggestPrompt(cvText: string, papers: { title: string; topic?: string; abstract?: string }[]): TextInput` — the CV text (as `cvText` makes it) and at most 40 papers (abstracts cut to 200 characters); asks for `{"roles":[string],"keywords":[string],"seniority":[string],"fields":[string],"locations":[string],"languages":[{"language":string,"level":string}]}` from the candidate's own material only.
- Produces: `export function parseSuggestion(text: string): Pick<CareerPrefs, 'roles' | 'keywords' | 'seniority' | 'fields' | 'locations' | 'languages'>` — each list at most 8 items, each string `visible()`-cleaned, trimmed, 1–60 characters, duplicates (case-insensitive) dropped; throws on a reply that is not that JSON.
- Produces: `export function contactAnswers(cv: CvConfig): Pick<ApplicationAnswers, 'phone' | 'address' | 'links'>` — `cv.cv.phone`, `cv.cv.location`, and one link per `cv.cv.social_networks` entry plus `cv.cv.website`, built with the same URL rule `answers.ts` uses (export and reuse that helper rather than copying it). No AI.
- Produces: `POST /api/admin/career/suggest` (`careerRoute`) → `{ prefs, answers }`; 400 `There is no CV yet: add one on the CV screen` when the CV text is empty; at most one AI call (a reply `parseSuggestion` rejects is a 502 with its message; no retry).
- CareerSettings.vue: on load, when prefs have no roles, keywords, fields, watched companies or feeds, call the route once and fill only empty fields (prefs and answers); a banner `Suggested from your CV and publications. Review, then Save.` shows until Save. A `Suggest from my site` button refills roles, keywords, seniority, fields, locations and languages (replacing them) and the empty answers, with the same banner. A failure shows its message in the banner and leaves the form as it was.

- [ ] **Step 1: Write the failing tests**

```ts
test('parseSuggestion caps, cleans and dedupes', () => {
  const s = parseSuggestion(JSON.stringify({ roles: ['Research Scientist', 'research scientist', 'x'.repeat(61), ...Array(10).fill('ML Engineer').map((r, i) => `${r} ${i}`)], keywords: ['Python​'], seniority: [], fields: [], locations: ['Orlando, FL'], languages: [{ language: 'Farsi', level: 'native' }] }));
  assert.equal(s.roles.length, 8);
  assert.equal(s.roles[0], 'Research Scientist');
  assert.equal(s.roles.filter((r) => /research scientist/i.test(r)).length, 1);
  assert.deepEqual(s.keywords, ['Python']);
  assert.doesNotThrow(() => validatePrefs({ ...s }));
  assert.throws(() => parseSuggestion('not json'));
});
test('contactAnswers copies contact details from the CV without AI', () => {
  const a = contactAnswers({ cv: { name: 'M', phone: '+1 407 555 0100', location: 'Orlando, FL', social_networks: [{ network: 'LinkedIn', username: 'me' }], sections: {} } } as CvConfig);
  assert.equal(a.phone, '+1 407 555 0100');
  assert.equal(a.address, 'Orlando, FL');
  assert.deepEqual(a.links.map((l) => l.url), ['https://linkedin.com/in/me']);
});
```

Route test: a non-owner gets 404; with no CV, 400 with the message above.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** as in Interfaces (`cvTextOf` in `steps.ts` already builds the CV text; export it rather than copying). Match the exact `ApplicationAnswers.links` item shape from `settings.ts`.
- [ ] **Step 4: Run** `npm test`, `npm run check`, `npm run lint` — all pass.
- [ ] **Step 5: Commit** — `Career: settings are suggested from the CV and publications`

---

## After the tasks

Deploy a preview from the branch's committed tree (the owner runs `vercel deploy --yes --environment=preview`), then on the same test data: run once (Google Jobs duplicates no longer added again), redraft posting 33 (Uber), and compare with the first draft: requirements panel, posting terms in highlights, skills order, papers by relevance from all 14. Merge only on the owner's word.
