# Complete Paper Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every publication complete and correct from wherever it was published (arXiv, bioRxiv/medRxiv, Crossref/DOI, PubMed, OpenAlex, or the owner's uploaded PDF) — full authors, links and PDF, full abstract, DOI, published venue, proper BibTeX — automatically for new Scholar imports, through an approval review for existing papers, on a sync schedule the owner sets in the admin.

**Architecture:** A pure sources module parses arXiv Atom and Crossref JSON and builds BibTeX; a completion module finds a paper's record (arXiv id → DOI → title search, with an author check), turns it into publication fields, and diffs them against an entry into proposed changes. `syncPapers` completes up to 10 new papers per run; two routes serve the review (read-only proposals in batches, and one apply/decline write); a review panel on the Publications screen shows field-by-field old/new with checkboxes. The git-mode Python sync stops overwriting existing entries.

**Tech Stack:** TypeScript, Astro 7.4 + Vue 3 admin, node:test via `npx tsx --test`, Python 3 (scripts), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-paper-import-design.md` (read its "Decided after review" section: it binds every task).

## Global Constraints

- arXiv: only `https://export.arxiv.org/api/query` (search_query / id_list); at most one request every 3 seconds; never scrape arxiv.org pages.
- bioRxiv/medRxiv: `https://api.biorxiv.org/details/<biorxiv|medrxiv>/<doi>`. PubMed: E-utilities `esearch`/`efetch` at `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`, ≤3 requests/s, with `tool=ScholarOS` and `email` when known. OpenAlex: `https://api.openalex.org/works` with `mailto` when known.
- Crossref: `https://api.crossref.org/works` with a `mailto:` in the User-Agent when the site has an email; DOI BibTeX via `https://doi.org/<doi>` with `Accept: application/x-bibtex`.
- All network goes through the existing safe fetch `getText`/`getJson` from `src/lib/career/sources/http.ts` (timeout, size cap, http(s) only, private-IP block); no new dependency; no SerpAPI credits for completion.
- Never touch the owner's fields: `topic`, `featured`, `image`, `note`, `venueShort`, `code`, `equalContribution`, and posts.
- A title match needs folded-title equality (`normalizeTitle`) AND at least one shared author surname; otherwise no match.
- Venue/type change only on proof of publication (a Crossref DOI record or arXiv `journal_ref`); never downgrade a non-arXiv venue to `arXiv`/`preprint`.
- Existing papers: nothing is written until "Apply selected"; declined `(slug, field, proposed value)` are remembered and not offered again. Proposals read from the owner's PDF are never pre-ticked, even for empty fields.
- Uploaded PDFs: at most 4 MB (`MAX_UPLOAD`), `application/pdf` only.
- The publication slug never changes; BibTeX keys use `generateId(authors, year, title)` from `src/lib/admin/papers.ts`.
- Before each commit: `npm test` 0 failures, `npm run check` 0 errors, `npm run lint`.

## Review Focus

1. A Scholar title in different case or punctuation from arXiv's ("Mirage: measuring …"): still matches by folded title, and the title is offered as a change. Test in Task 2.
2. A same-title paper by other people (common titles like "Attention is all you need"): no match without a shared surname. Test in Task 2.
3. Scholar's abbreviated, truncated authors ("M Yazdani-Jahromi, AK Yalabadi, …"): surname matching still works on those. Test in Task 2.
4. arXiv or Crossref down / timing out mid-run: the paper imports uncompleted, the run reports it, nothing else fails. Test in Task 3.
5. An owner who declined a change and presses "Complete papers" again: not offered again; a different new value is. Test in Task 4.

---

### Task 1: Paper sources — arXiv and Crossref parsing, BibTeX

**Files:**
- Create: `src/lib/admin/paper-sources.ts`
- Create: `tests/fixtures/papers/arxiv-mirage.xml`, `tests/fixtures/papers/arxiv-search.xml`, `tests/fixtures/papers/crossref-search.json`, `tests/fixtures/papers/doi.bib`
- Test: `src/lib/admin/paper-sources.test.ts`

Record the fixtures once from the live APIs (then tests never touch the network): `https://export.arxiv.org/api/query?id_list=2609.14491` (MIRAGE), a `search_query=au:"Yazdani-Jahromi"&max_results=5` response, a Crossref `query.bibliographic=Equi-mRNA Protein Translation Equivariant Encoding` response (`rows=3`), and the BibTeX from `https://doi.org/10.52202/085713-0904` with `Accept: application/x-bibtex`. Keep each small (trim to the entries used).

**Interfaces:**
- Produces:
  ```ts
  export type PubType = 'journal' | 'conference' | 'preprint' | 'workshop' | 'thesis' | 'book-chapter';
  export interface PaperRecord {
    source: 'arxiv' | 'crossref';
    title: string; authors: string[]; year: number;
    abstract?: string; arxiv?: string; primaryClass?: string; doi?: string;
    journalRef?: string;           // arXiv's arxiv:journal_ref
    venue?: string; type?: PubType; // Crossref container-title / mapped type
  }
  export function parseArxivFeed(xml: string): PaperRecord[];
  export function parseCrossrefWorks(json: unknown): PaperRecord[];
  export function arxivBibtex(r: PaperRecord, key: string): string;
  ```
  - arXiv: `arxiv` is the id without version (`2609.14491`), `year` the first-submission year (`<published>`), authors from `<name>` in order, abstract from `<summary>` with whitespace collapsed, `primaryClass` from `arxiv:primary_category`, `doi`/`journalRef` when present. Parse with regexes over the Atom (no XML dependency); decode the five XML entities.
  - Crossref: authors `given family` (just `family` if no given), `year` from `issued.date-parts[0][0]`, `venue` = first `container-title`, `type` mapped `journal-article→journal`, `proceedings-article→conference`, `posted-content→preprint`, `book-chapter→book-chapter`, else undefined; abstract with JATS tags stripped.
  - Also `parseBiorxiv(json: unknown, server: 'biorxiv' | 'medrxiv'): PaperRecord[]` (authors from `authors` "Last, F.; …" kept as given, abstract, `doi`, `year`, venue = `bioRxiv`/`medRxiv`, type `preprint`, `published` DOI when the API reports one), `parsePubmed(xml: string): PaperRecord[]` (efetch XML: `ArticleTitle`, `AbstractText` parts joined, authors `ForeName LastName`, `Journal/Title`, year, `ELocationID[@EIdType="doi"]`, type `journal`), and `parseOpenAlex(json: unknown): PaperRecord[]` (`display_name`, authors `author.display_name`, abstract rebuilt from `abstract_inverted_index`, `primary_location.source.display_name` venue, `type` mapped `article→journal`, `proceedings-article`/`conference`→`conference`, `preprint`→`preprint`, `doi` without the `https://doi.org/` prefix, `publication_year`, open-access PDF `best_oa_location.pdf_url` as `pdf`). `PaperRecord.source` widens to `'arxiv' | 'biorxiv' | 'medrxiv' | 'crossref' | 'pubmed' | 'openalex' | 'pdf'` and gains `pdf?: string`. Fixtures: record one bioRxiv, one PubMed and one OpenAlex response for one of the owner's papers (`tests/fixtures/papers/biorxiv.json`, `pubmed.xml`, `openalex.json`) and add a parsing test for each asserting full author names, a non-empty abstract and the DOI.
  - `arxivBibtex` writes arXiv's own format: `@misc{<key>,\n  title = {…},\n  author = {A and B and C},\n  year = {YYYY},\n  eprint = {<id>},\n  archivePrefix = {arXiv},\n  primaryClass = {<cls>},\n  url = {https://arxiv.org/abs/<id>}\n}`.

- [ ] **Step 1: Write the failing tests**

```ts
test('parseArxivFeed reads MIRAGE in full', () => {
  const [r] = parseArxivFeed(fixture('arxiv-mirage.xml'));
  assert.equal(r.source, 'arxiv');
  assert.equal(r.arxiv, '2609.14491');
  assert.match(r.title, /^MIRAGE: Measuring Interpolation and Redundancy in Affinity GEneralization/);
  assert.equal(r.authors.length, 3);
  assert.ok(r.authors.includes('Mehdi Yazdani-Jahromi'));
  assert.ok((r.abstract ?? '').length > 300 && !/\n/.test(r.abstract!));
  assert.equal(r.year, 2026);
});
test('parseArxivFeed handles several entries and entities', () => {
  const rs = parseArxivFeed(fixture('arxiv-search.xml'));
  assert.ok(rs.length >= 2 && rs.every((r) => r.arxiv && !/v\d+$/.test(r.arxiv)));
  assert.equal(parseArxivFeed('<feed></feed>').length, 0);
});
test('parseCrossrefWorks maps authors, year, venue and type', () => {
  const [r] = parseCrossrefWorks(JSON.parse(fixture('crossref-search.json')));
  assert.equal(r.doi, '10.52202/085713-0904');
  assert.deepEqual(r.authors.slice(0, 2), ['Mehdi Yazdani-Jahromi', 'Ali Khodabandeh Yalabadi']);
  assert.ok(r.venue && r.year > 2000);
});
test('arxivBibtex writes arXiv's format', () => {
  const [r] = parseArxivFeed(fixture('arxiv-mirage.xml'));
  const b = arxivBibtex(r, 'yazdanijahromi2026mirage');
  assert.match(b, /^@misc\{yazdanijahromi2026mirage,/);
  assert.match(b, /eprint = \{2609\.14491\}/);
  assert.match(b, /archivePrefix = \{arXiv\}/);
  assert.match(b, /author = \{[^}]+ and [^}]+ and [^}]+\}/);
});
```

- [ ] **Step 2: Run** `npx tsx --test src/lib/admin/paper-sources.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** — PASS; then `npm run check`.
- [ ] **Step 5: Commit** — `Papers: parse arXiv and Crossref records, write arXiv BibTeX`

---

### Task 2: Finding a paper and turning it into fields

**Files:**
- Create: `src/lib/admin/paper-complete.ts`
- Test: `src/lib/admin/paper-complete.test.ts`

**Interfaces:**
- Consumes: Task 1's `PaperRecord`, `parseArxivFeed`, `parseCrossrefWorks`, `arxivBibtex`; `normalizeTitle`, `generateId`, `inferType` from `src/lib/admin/papers.ts` (export `inferType` if it isn't).
- Produces:
  ```ts
  /** All network a completion needs; tests fake it by URL. `accept` defaults to JSON/Atom. */
  export interface Lookup { get(url: string, accept?: string): Promise<string> }
  export const COMPLETABLE = ['title', 'authors', 'venue', 'year', 'type', 'doi', 'arxiv', 'url', 'pdf', 'abstract', 'bibtex'] as const;
  export type Completable = (typeof COMPLETABLE)[number];
  export type Completed = Partial<Record<Completable, unknown>>;
  export function surnames(authors: string[]): Set<string>;   // folded last word of each name
  export function sameAuthors(a: string[], b: string[]): boolean; // shares at least one surname
  export async function findPaper(pub: { title: string; authors: string[]; doi?: string; arxiv?: string; url?: string; pdf?: string }, look: Lookup): Promise<{ arxiv?: PaperRecord; crossref?: PaperRecord } | null>;
  export async function completedFields(found: { arxiv?: PaperRecord; crossref?: PaperRecord }, current: { venue?: string; type?: string }, look: Lookup): Promise<Completed>;
  export function paperLookup(opts: { siteUrl: string; email?: string }): Lookup; // real one: safe fetch, ≥3 s between export.arxiv.org calls, UA with mailto
  ```
- Sources beyond arXiv/Crossref (spec "Owner additions" 2): `findPaper` returns `Partial<Record<PaperRecord['source'], PaperRecord>>`. After the arXiv/Crossref steps below, a DOI starting `10.1101/` is looked up on bioRxiv then medRxiv; PubMed is searched by DOI (`term=<doi>[doi]`) or else by exact title (`term="<title>"[title]`); OpenAlex by DOI (`/works/doi:<doi>`) or else `search=<title>`; every title hit passes the same title+surname rule. `completedFields` merges by the spec's precedence (authors/title/abstract: arXiv or bioRxiv/medRxiv when a preprint there, else Crossref, PubMed, OpenAlex; venue/type/year/DOI from the published record Crossref → PubMed → OpenAlex on proof of publication; `pdf`: arXiv PDF, else OpenAlex open-access PDF; BibTeX: DOI → publisher, else arXiv-style, else built `@article`/`@inproceedings`/`@misc` from the merged fields). Add tests: a PubMed-only paper (fake lookup) gets its abstract and full authors from PubMed; an OpenAlex-only conference paper gets venue and abstract; a bioRxiv DOI completes from bioRxiv.
- Lookup order in `findPaper`: arXiv id (from `arxiv`, or an arxiv.org `/abs/` or `/pdf/` URL in `url`/`pdf`) via `id_list`; else DOI via `https://api.crossref.org/works/<doi>`; else arXiv title search (`search_query=ti:"<title with punctuation removed>"`, `max_results=5`) then Crossref `query.bibliographic=<title>&rows=5`. Every candidate from a search must pass `normalizeTitle` equality and `sameAuthors`. When arXiv matched and gave no DOI, run one Crossref title search for a published version (same rule). Returns null when nothing matches.
- `completedFields`: authors/title/abstract/arxiv/url/pdf from arXiv when present (`url` = `https://arxiv.org/abs/<id>`, `pdf` = `https://arxiv.org/pdf/<id>`), else from Crossref (`url` = `https://doi.org/<doi>`); `doi` from either; venue/type/year: published (Crossref record) → its venue/mapped type/year; else arXiv `journalRef` → venue = journalRef, type = `inferType(journalRef)`; else arXiv-only → venue `arXiv`, type `preprint`, year = arXiv year — but only if `current.venue` is empty or already arXiv-like (`inferType(current.venue) === 'preprint'`); otherwise leave venue/type out. `bibtex`: DOI → `look.get('https://doi.org/<doi>', 'application/x-bibtex')` (trimmed; a failure falls back), else `arxivBibtex(record, generateId(authors, year, title))`.

- [ ] **Step 1: Write the failing tests** (a fake `Lookup` returning Task 1's fixtures by URL prefix and recording URLs)

```ts
test('an arXiv id is looked up directly and completes MIRAGE', async () => {
  const look = fake({ 'https://export.arxiv.org/api/query?id_list=2609.14491': 'arxiv-mirage.xml', 'https://api.crossref.org/works?': '{"message":{"items":[]}}' });
  const found = await findPaper({ title: 'x', authors: [], arxiv: '2609.14491' }, look);
  const f = await completedFields(found!, {}, look);
  assert.equal(f.url, 'https://arxiv.org/abs/2609.14491');
  assert.equal(f.pdf, 'https://arxiv.org/pdf/2609.14491');
  assert.equal(f.arxiv, '2609.14491');
  assert.equal((f.authors as string[]).length, 3);
  assert.equal(f.venue, 'arXiv');
  assert.equal(f.type, 'preprint');
  assert.match(String(f.bibtex), /^@misc\{/);
});
test('a title search matches Scholar's abbreviated, truncated authors and other casing', async () => {
  const look = fake({ 'https://export.arxiv.org/api/query?search_query=': 'arxiv-mirage.xml', 'https://api.crossref.org/works?': '{"message":{"items":[]}}' });
  const found = await findPaper({ title: 'Mirage: measuring interpolation and redundancy in affinity generalization', authors: ['M Yazdani-Jahromi', 'AK Yalabadi', '…'] }, look);
  assert.equal(found?.arxiv?.arxiv, '2609.14491');
});
test('the same title by other people is not a match', async () => {
  const look = fake({ 'https://export.arxiv.org/api/query?search_query=': 'arxiv-mirage.xml', 'https://api.crossref.org/works?': '{"message":{"items":[]}}' });
  assert.equal(await findPaper({ title: 'MIRAGE: Measuring Interpolation and Redundancy in Affinity GEneralization', authors: ['J Doe'] }, look), null);
});
test('a published conference venue is never downgraded to arXiv', async () => {
  const look = fake({ 'https://export.arxiv.org/api/query?id_list=': 'arxiv-mirage.xml', 'https://api.crossref.org/works?': '{"message":{"items":[]}}' });
  const found = await findPaper({ title: 'x', authors: [], arxiv: '2609.14491' }, look);
  const f = await completedFields(found!, { venue: 'Advances in Neural Information Processing Systems', type: 'conference' }, look);
  assert.equal(f.venue, undefined);
  assert.equal(f.type, undefined);
});
test('a DOI gives the published venue and the publisher BibTeX', async () => {
  const look = fake({ 'https://api.crossref.org/works/10.52202': crossrefWork, 'https://doi.org/10.52202/085713-0904': 'doi.bib' });
  const found = await findPaper({ title: 'x', authors: [], doi: '10.52202/085713-0904' }, look);
  const f = await completedFields(found!, {}, look);
  assert.ok(f.venue && f.type !== 'preprint');
  assert.equal(String(f.bibtex).trim(), fixture('doi.bib').trim());
});
```
(`crossrefWork` = `{ message: <the first item of crossref-search.json> }`.)

- [ ] **Step 2: Run** `npx tsx --test src/lib/admin/paper-complete.test.ts` — FAIL.
- [ ] **Step 3: Implement** as in Interfaces; `paperLookup` uses `getText` with headers `{ Accept: accept ?? 'application/json, application/atom+xml', 'User-Agent': 'ScholarOS paper import (+<siteUrl>; mailto:<email>)' }` and keeps the last export.arxiv.org call time in a closure to wait the remainder of 3 s.
- [ ] **Step 4: Run** — PASS; `npm run check`.
- [ ] **Step 5: Commit** — `Papers: find a paper on arXiv or Crossref and complete its fields`

---

### Task 3: New Scholar imports are completed

**Files:**
- Modify: `src/lib/admin/papers.ts` (`PapersDeps`, `PapersResult`, `syncPapers`, `papersDeps`, `papersSummary`)
- Test: `src/lib/admin/papers.test.ts`

**Interfaces:**
- Consumes: Task 2's `Lookup`, `findPaper`, `completedFields`, `paperLookup`.
- Produces: `PapersDeps.lookup: Lookup`; `PapersResult.notCompleted: string[]` (publication slugs imported as Scholar gave them); `export const COMPLETE_PER_RUN = 10`.
- Behaviour: for the first `COMPLETE_PER_RUN` planned papers (newest first), `findPaper` + `completedFields` run before `pubOf`, and their fields win over Scholar's (Scholar's `link` stays only when no `url` was found); the abstract found also feeds the post prompt. A paper past the budget, with no match, or whose lookup throws is imported as today and listed in `notCompleted`; a lookup error is also pushed to `failed` as `{ item: 'completing <slug>', error }`. `papersSummary` adds `· <n> not completed (use Complete papers)` when non-empty. `papersDeps` builds `lookup` with `paperLookup({ siteUrl, email })` from the site config (`siteUrl`, and the CV/site email if present).

- [ ] **Step 1: Write the failing tests** (extend the existing fake deps with a `lookup` that serves Task 1 fixtures)

```ts
test('a new Scholar paper is completed from arXiv', async () => {
  // Scholar returns MIRAGE as "M Yazdani-Jahromi, AK Yalabadi, …" with a scholar link
  const r = await syncPapers(store, depsWith({ lookup: fakeLookup({ mirage: true }) }));
  const pub = await readPublication(r.imported[0]);
  assert.equal(pub.url, 'https://arxiv.org/abs/2609.14491');
  assert.equal(pub.arxiv, '2609.14491');
  assert.equal(pub.authors.length, 3);
  assert.ok(pub.abstract && pub.bibtex);
  assert.deepEqual(r.notCompleted, []);
});
test('when the sources fail, the paper imports as Scholar gave it and the run says so', async () => {
  const r = await syncPapers(store, depsWith({ lookup: { get: async () => { throw new Error('timeout'); } } }));
  assert.equal(r.imported.length, 1);
  assert.deepEqual(r.notCompleted, r.imported);
  assert.match(papersSummary(r), /1 not completed/);
});
test('only COMPLETE_PER_RUN papers are completed per run', async () => {
  // Scholar returns 12 new papers; the lookup counts findPaper calls
  const { lookup, calls } = countingLookup();
  const r = await syncPapers(store, depsWith({ scholarArticles: 12, lookup }));
  assert.equal(r.notCompleted.length, 2);
  assert.ok(calls.papers <= COMPLETE_PER_RUN);
});
```

- [ ] **Step 2: Run** `npx tsx --test src/lib/admin/papers.test.ts` — FAIL.
- [ ] **Step 3: Implement** as in Interfaces (keep the existing baseline, deferral, post and commit logic unchanged).
- [ ] **Step 4: Run** — PASS; full suite, `npm run check`.
- [ ] **Step 5: Commit** — `Papers: new Scholar imports are completed from arXiv and Crossref`

---

### Task 4: Proposals for existing papers, and applying them

**Files:**
- Modify: `src/lib/admin/paper-complete.ts` (proposals, declines)
- Modify: `src/lib/admin/papers.ts` (`ScholarState` gains `declined`; `parseState` keeps it)
- Create: `src/admin/routes/api/papers/complete.ts`
- Test: `src/lib/admin/paper-complete.test.ts`, `src/lib/admin/routes.test.ts` (or a new `paper-complete-route.test.ts` following its pattern)

**Interfaces:**
- Produces:
  ```ts
  export interface FieldChange { field: Completable; from: unknown; to: unknown; fill: boolean; source: PaperRecord['source'] } // fill = the field was empty; source = where `to` came from
  export interface PaperProposal { slug: string; title: string; changes: FieldChange[]; error?: string; noMatch?: true }
  export type Declined = Record<string, Partial<Record<Completable, string>>>; // slug → field → JSON of the declined value
  export function proposeChanges(current: Record<string, unknown>, completed: Completed, declined?: Partial<Record<Completable, string>>): FieldChange[];
  ```
  - `completedFields` returns, alongside the values, which source each field came from (`sources: Partial<Record<Completable, PaperRecord['source']>>`), used for `FieldChange.source`.
  - A field is a change when `completed[field]` is defined and differs from `current[field]` (deep-equal for arrays; a title differing only in whitespace is not a change; an equal value is not a change). Skip it when `declined[field] === JSON.stringify(completed[field])`. Order follows `COMPLETABLE`.
- Routes (`route()` from `src/lib/admin/http`, both modes, admin-only like `papers/sync.ts`):
  - `GET /api/admin/papers/complete?offset=<n>&limit=<n>` (limit ≤ 10, default 10) → `{ total, offset, proposals: PaperProposal[] }` over `listEntries(store, 'publications')` sorted by slug; read-only. A lookup error is the proposal's `error`; no match is `noMatch: true`.
  - `POST /api/admin/papers/complete` body `{ slug: string, apply: Completable[], decline: { field: Completable, value: unknown }[] }`: re-reads the entry and recomputes its proposal (never trusts client values), writes `apply`'s fields with `entryChange('publications', slug, {...data, ...picked}, body)` and records `decline` in `scholar.json`'s `declined`, in ONE `commitChanges` with the entry's and the state file's versions; returns the updated proposal. An unknown slug is 404; a field not in the recomputed proposal is 409 ("This paper changed; reload the review").

- [ ] **Step 1: Write the failing tests**

```ts
test('proposeChanges: fills, replacements, whitespace-only titles and declines', () => {
  const current = { title: 'Mirage:  measuring interpolation', authors: ['M Yazdani-Jahromi'], url: 'https://scholar.google.com/x' };
  const completed = { title: 'Mirage: measuring interpolation', authors: ['Mehdi Yazdani-Jahromi', 'A B', 'C D'], url: 'https://arxiv.org/abs/2609.14491', arxiv: '2609.14491' };
  const ch = proposeChanges(current, completed);
  assert.deepEqual(ch.map((c) => [c.field, c.fill]), [['authors', false], ['arxiv', true], ['url', false]]);
  const again = proposeChanges(current, completed, { url: JSON.stringify('https://arxiv.org/abs/2609.14491') });
  assert.deepEqual(again.map((c) => c.field), ['authors', 'arxiv']);
  const newer = proposeChanges(current, { ...completed, url: 'https://arxiv.org/abs/2609.14491v2' }, { url: JSON.stringify('https://arxiv.org/abs/2609.14491') });
  assert.ok(newer.some((c) => c.field === 'url'), 'a different value is offered again');
});
```
Route tests (fake lookup injected the way papers routes get deps): GET returns a proposal for MIRAGE with `authors` not `fill` and `arxiv` `fill`, and writes nothing (store versions unchanged); POST applying `['arxiv','authors']` and declining `url` writes those two fields only, keeps `topic`/`featured`/`image` untouched, records the decline, and a second GET no longer lists `url`; POST with a field not in the proposal is 409.

- [ ] **Step 2: Run** the two test files — FAIL.
- [ ] **Step 3: Implement** as in Interfaces. The routes get their `Lookup` from a small exported `paperLookupFor(store)` in papers.ts (site URL + email) so tests can swap it via a setter like other test hooks in the repo (follow the existing `set…ForTests` pattern).
- [ ] **Step 4: Run** — PASS; full suite, `npm run check`.
- [ ] **Step 5: Commit** — `Papers: propose completions for existing papers and apply the ones approved`

---

### Task 5: The review on the Publications screen

**Files:**
- Create: `src/admin/PaperReview.vue`
- Modify: `src/admin/Collection.vue` (a `Complete papers` button in the publications list header, opening the review)
- Modify: `src/admin/admin.css` only if needed
- Test: `src/admin/paper-review.test.ts` for any pure helper (e.g. formatting a value for display)

**Interfaces:**
- Consumes: Task 4's routes and types (`PaperProposal`, `FieldChange`, `Completable`).
- Behaviour: the button opens a panel that loads proposals batch by batch (`offset` += 10, "Checking papers… 10 of 23" progress) until `total`. Papers with changes are listed (title, then one row per field: label, old value, new value, its source ("arXiv", "Crossref", "PubMed", "OpenAlex", "bioRxiv", "medRxiv", "your PDF"), a checkbox — ticked by default when `fill` and the source isn't `pdf`, unticked otherwise); papers with no changes are summarised in one line; `noMatch` and `error` papers listed under "Couldn't complete" with the reason. Per paper, "Apply selected" POSTs `{ slug, apply: ticked, decline: unticked }` and replaces that paper's block with the returned proposal (empty → "Up to date"). Authors show as a comma list; abstract and BibTeX in a scrollable `<pre>`-style block; all text by interpolation (never `v-html`). Copy: button `Complete papers`; panel title `Complete papers from arXiv and Crossref`; intro `Empty fields are ticked. Changes to what you have are not; tick the ones you want. Unticked changes won't be offered again.`

- [ ] **Step 1:** Write a failing test for the display helper (`displayValue(field, value): string` — authors joined with ', ', arrays generally joined, undefined → '—').
- [ ] **Step 2:** Run it — FAIL.
- [ ] **Step 3:** Implement the helper, the component and the button; `npm run check` 0 errors.
- [ ] **Step 4:** Run the test — PASS; full suite.
- [ ] **Step 5: Commit** — `Admin: review and apply paper completions on the Publications screen`

---

### Task 6: The weekly Python sync stops overwriting, and docs

**Files:**
- Modify: `scripts/sync-scholar.py` (`merge_with_existing`, ~line 218)
- Create: `scripts/test_sync_scholar.py` (pytest-style, like `scripts/test_render_cv.py`; check how CI runs that file and run this one the same way)
- Modify: `README.md` (the Scholar/publications section: completion of new imports, the Complete papers review, sources and their limits, that the weekly git-mode sync only adds papers)

**Interfaces:**
- Behaviour: an existing entry (matched by id or normalized title) keeps every non-empty field it has; Scholar's value fills only empty fields. New papers are still added; CMS-only papers still kept.

- [ ] **Step 1: Write the failing test**

```python
def test_existing_entries_keep_their_fields():
    existing = [{"id": "p1", "title": "MIRAGE: Measuring", "authors": ["Mehdi Yazdani-Jahromi"], "venue": "arXiv", "year": 2026, "abstract": "full"}]
    new = [{"id": "p1", "title": "Mirage: measuring", "authors": ["M Yazdani-Jahromi"], "venue": "arXiv preprint", "year": 2026, "url": "https://scholar.google.com/x"}]
    [m] = merge_with_existing(new, existing)
    assert m["authors"] == ["Mehdi Yazdani-Jahromi"] and m["title"] == "MIRAGE: Measuring" and m["venue"] == "arXiv"
    assert m["url"] == "https://scholar.google.com/x"  # empty before: filled
```
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement** (drop the `or key in ("title", "authors", "venue", "year")` override); update the README.
- [ ] **Step 4: Run** it and the existing Python tests — PASS; `npm run lint`.
- [ ] **Step 5: Commit** — `Scholar sync: keep existing entries' fields; README on completing papers`

---

### Task 7: A papers sync schedule set in the admin

**Files:**
- Modify: `src/lib/ai/providers.ts` (`resolveAiConfig(...).papers` gains `schedule`), the ai config schema wherever `papers` is validated
- Modify: `src/lib/admin/jobs.ts` (the `papers` step skips when not due)
- Modify: `src/admin/Ai.vue` (Frequency select: Off / Every day / Every week on … / Every month on day …)
- Modify: `.github/workflows/sync-scholar.yml` (daily schedule `0 6 * * *`; a first step that exits unless due) and `scripts/sync-scholar.py` (read `config/ai.yml` `papers.schedule`; add `--if-due`)
- Test: `src/lib/admin/papers-schedule.test.ts` (or alongside jobs tests), `scripts/test_sync_scholar.py`

**Interfaces:**
- Produces: `export type PapersSchedule = { every: 'off' | 'day' | 'week' | 'month'; weekday?: number; monthday?: number }` (default `{ every: 'day' }`; `weekday` 0–6 Sunday-first, default 1; `monthday` 1–28, default 1) and `export function papersDue(s: PapersSchedule, now: Date): boolean` (UTC date) in `src/lib/admin/papers.ts`; the Python side mirrors it as `papers_due(schedule, today)`.
- Behaviour: the jobs `papers` step returns `{ detail: 'not due (weekly on Monday)' }` style details when skipped (recorded as ok, not failed); "Check now" ignores the schedule.

- [ ] **Step 1: Write the failing tests**
```ts
test('papersDue', () => {
  const mon = new Date('2026-10-19T03:00:00Z'), tue = new Date('2026-10-20T03:00:00Z'), first = new Date('2026-11-01T03:00:00Z');
  assert.equal(papersDue({ every: 'day' }, tue), true);
  assert.equal(papersDue({ every: 'off' }, mon), false);
  assert.equal(papersDue({ every: 'week', weekday: 1 }, mon), true);
  assert.equal(papersDue({ every: 'week', weekday: 1 }, tue), false);
  assert.equal(papersDue({ every: 'month', monthday: 1 }, first), true);
  assert.equal(papersDue({ every: 'month', monthday: 1 }, tue), false);
});
```
A jobs test: with `schedule: { every: 'week', weekday: 1 }` on a Tuesday the papers step doesn't call `syncPapers` and records a "not due" detail. A Python test: `papers_due` matches the same table.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; full suite, `npm run check`.
- [ ] **Step 5: Commit** — `Papers: the sync runs on a schedule set on the Scholar & AI screen`

---

### Task 8: Upload a PDF for a paper

**Files:**
- Modify: `src/lib/admin/media.ts` (allow `pdf: 'application/pdf'`, same `MAX_UPLOAD`; PDFs are files, not images: no image processing, no use as cover)
- Modify: `src/admin/Collection.vue` (publications editor: "Upload PDF" next to the `pdf` field; uploads through the existing media upload route and sets `pdf` to the returned URL; shows the 4 MB message on 413)
- Test: `src/lib/admin/media.test.ts`

**Interfaces:**
- Produces: an uploaded PDF's public URL in the publication's `pdf` field (Postgres mode: Blob; git mode: the media folder), via the existing upload API.

- [ ] **Step 1: Write the failing tests** — a PDF (bytes starting `%PDF-`) under 4 MB uploads and is listed with type `application/pdf`; a file named `.pdf` whose bytes aren't a PDF is refused (415 or 400, following the module's existing sniffing); a 5 MB PDF gets the existing 413 message.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; full suite, `npm run check`.
- [ ] **Step 5: Commit** — `Admin: upload a PDF for a publication`

---

### Task 9: Completing a paper from its own PDF

**Files:**
- Modify: `src/lib/ai/providers.ts` (`TextInput` gains `pdf?: { name: string; bytes: Uint8Array }`; OpenAI sends it as an `input_file` with base64 data, Anthropic as a `document` block with base64 `application/pdf`, Gemini as `inline_data` `application/pdf`)
- Modify: `src/lib/admin/paper-complete.ts` (`fromPdf(pdf: Uint8Array, ai): Promise<PaperRecord | null>`: a prompt asking for `{"title","authors":[…],"abstract","year"}` from the paper itself only, parsed with `jsonObject`, strings `visible()`-cleaned; source `'pdf'`)
- Modify: `src/admin/routes/api/papers/complete.ts` (GET: for a paper with an uploaded `pdf` on the site's own media and no source match — or still missing `abstract` or full authors — add PDF-derived changes; at most 5 PDF reads per GET batch)
- Test: `src/lib/ai/providers.test.ts`, `src/lib/admin/paper-complete.test.ts`

**Interfaces:**
- Consumes: Task 4's proposals; the AI config (`readAiConfig`, `generateText`).
- Behaviour: PDF-derived changes have `source: 'pdf'` and are never pre-ticked (Task 5); only the owner's own uploaded PDF (a URL on the site's media) is read, never a third-party URL.

- [ ] **Step 1: Write the failing tests** — each provider builds a request carrying the PDF in its documented shape (assert on the fetch body the existing provider tests capture); `fromPdf` with a fake AI reply returns a `pdf`-sourced record with cleaned strings and rejects a non-JSON reply; a proposal for a no-match paper with an uploaded PDF lists `abstract` with `source: 'pdf'`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; full suite, `npm run check`.
- [ ] **Step 5: Commit** — `Papers: complete a paper from its uploaded PDF, as a proposal`

---

## After the tasks

On a preview (owner signs in): press Complete papers; MIRAGE shows full authors, arXiv link/id/PDF, abstract and BibTeX, with the author and link replacements unticked; apply them; reload — not offered again. Merge only on the owner's word, then update the site repo with an ordinary merge (it now shares ScholarOS history).
