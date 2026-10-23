# Public Readings and Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can make a paper (its note and chosen highlights) or a free note public, and visitors see them on
`/readings` and `/notes` (with a graph of the public notes), plus an open `graph.json` and an Obsidian-ready
`vault.zip`.

**Architecture:** New columns mark what is public (`vault_notes.public`, `reading_highlights.public`). After
every vault write, `republish` recomputes the published copies of all public notes (Markdown with front matter) and
commits only the differences into `documents` at `src/content/readings/<slug>.md` and `src/content/notes/<slug>.md`
through `PostgresStore`, so they behave exactly like posts: cache tags, git backup, `db:export`, static builds. Public
pages read only those copies through `getEntries('readings' | 'notes')`, never the vault tables.

**Tech Stack:** Astro 7, Vue 3 (admin and one island), postgres.js / pglite tests (`tsx --test`), zod (`astro/zod`),
`yaml`.

**Spec:** `docs/superpowers/specs/2026-10-23-public-notes-and-demo-design.md` (Part 1 only).

## Global Constraints

- Nothing private reaches a public page, `graph.json`, `vault.zip`, `documents`, the git backup or `db:export`, except
  the published copies of items the owner marked public.
- A link to a note that is not public loses its target: `[[Private title|shown text]]` keeps only "shown text";
  `[[Private title]]` (also with `#heading`, also as `![[…]]`) becomes "(private note)".
- Chat notes cannot be made public. AI text (summaries, findings, study aids, chat answers) is never public.
- A public highlight shows at most 300 characters of the paper's words; at most 10 public highlights per paper; its
  comment is public with it. Highlights are private by default.
- A note's public address is fixed when it is first published and kept through renames and unpublish/republish; the
  stable id is a UUID (`vault_notes.uid`), not the title.
- Making a note private deletes its copy. Saving a public note updates its copy.
- `readings` and `notes` are `SITE_PAGES` entries that are **off until turned on** (unlike the other pages, absent
  means off).
- Public pages work in Postgres mode and from committed content in static and git modes.
- Owner-only, Postgres-only admin routes (`careerRoute`), as for the rest of Reading.
- A failed republish never fails the owner's save: the response carries `publishWarning` and the admin offers
  "Publish again".
- Write comments like the surrounding code (sparse, a non-obvious why only). Tests: `tsx --test`, pglite via
  `pgliteSql()` + `migrate()`.
- Final verification includes `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build` and
  `VERCEL=1 VERCEL_DEPLOYMENT_ID=dpl_local DATABASE_URL=postgres://x:y@127.0.0.1:1/z pnpm build`, and
  `pnpm check:themes --structural`.
- Never write to a Vercel preview of the owner's site; nothing is pushed or deployed.

## Decisions this plan makes (beyond the spec)

- Paper metadata shown publicly is what `reading_papers` holds: title, authors, URL, arXiv id, DOI, publication date.
  There is no venue field, so no venue is shown.
- The published copy keeps `[[wikilinks]]` to public notes in its body (the shape the vault exports, and what Part 2's
  importer wants). The site turns them into links when rendering, by title.
- Public URLs end in `/`: `/readings/<slug>/`, `/notes/<slug>/` (the sitemap's convention).
- Readings are ordered by first-publish time (`public_at`), newest first; the index shows a plain-text excerpt of the
  note (280 characters) and the highlight count; the paper page shows everything.
- Turning Readings or Notes on in Pages does not add a menu item; the switch's hint says to add one under Settings →
  Menu items.

## Review Focus

1. A private title leaking through a link variant: different case or whitespace (`[[ secret  note ]]`), `#heading`,
   `|alias`, an embed `![[…]]`, or a link inside a code span. Each is stripped to its alias or "(private note)".
   Pinned in Task 2.
2. Renaming a public note: its slug stays; other public notes linking to it are rewritten by `renameNote` and their
   copies update; no copy is left at an old path. Pinned in Task 3.
3. Making a note private, or deleting it: its copy goes, and links to it in other public copies become plain text; its
   graph edges go. Pinned in Task 3.
4. A republish with nothing changed commits nothing (no new `revisions` rows, no purge), so autosave doesn't churn.
   Pinned in Task 3.
5. A title with no ASCII letters (e.g. `یادداشت`, `注意`) gets the slug `note-<first 8 hex of uid>` and its pages
   render. Pinned in Task 1.

---

### Task 1: Migration 011 and the public state in the database

**Files:**
- Create: `migrations/011_public_notes.sql`
- Modify: `src/lib/reading/types.ts` (`VaultNote`, `Highlight`)
- Modify: `src/lib/reading/vault-db.ts` (`toNote`, new functions)
- Modify: `src/lib/reading/room-db.ts` (highlight row mapping, new function)
- Modify: `src/lib/reading/limits.ts`
- Test: `src/lib/reading/publish-state.test.ts`

**Interfaces:**
- Produces:
  - Columns: `vault_notes.uid uuid not null default gen_random_uuid()` (unique), `vault_notes.public boolean not null
    default false`, `vault_notes.public_slug text` (unique where not null, kept after unpublish),
    `vault_notes.public_at timestamptz` (first publish, kept), check `not public or kind <> 'chat'`;
    `reading_highlights.public boolean not null default false`.
  - `VaultNote` gains `uid: string; public: boolean; publicSlug: string | null; publicAt: string | null`.
  - `Highlight` gains `public: boolean`.
  - `limits.ts`: `PUBLIC_HIGHLIGHTS_MAX = 10`, `PUBLIC_QUOTE_MAX = 300`.
  - `setNotePublic(sql: Sql, id: number, on: boolean): Promise<VaultNote | 'chat' | null>` in `vault-db.ts`: null when
    no such note; 'chat' for a chat note when `on`; on first publish assigns `public_slug` (under `withTitles`, so two
    publishes can't take one slug) and `public_at = now()`; unpublish keeps both.
  - `publicSlug(title: string, uid: string, taken: Set<string>): string` in `vault-db.ts` (pure, exported for tests):
    `uniqueSlug(suggestSlug(title) || 'note-' + uid.slice(0, 8), taken)` using `src/lib/utils.ts`.
  - `setHighlightPublic(sql: Sql, id: number, on: boolean): Promise<boolean | 'full'>` in `room-db.ts`: false when no
    such highlight; 'full' when turning on would make 11 for its paper (the count is taken with the paper's
    highlights row-locked, so two toggles can't both pass at 10).

- [ ] **Step 1: Write the failing tests** in `src/lib/reading/publish-state.test.ts` (pglite + `migrate`, set up notes
  as `vault-db.test.ts` does):

```ts
test('a note gets a uuid and starts private', async () => {
  const n = await make('Attention');
  assert.match(n.uid, /^[0-9a-f-]{36}$/);
  assert.equal(n.public, false);
  assert.equal(n.publicSlug, null);
});
test('first publish fixes the slug; rename and unpublish keep it', async () => {
  const n = await make('Attention Is All You Need');
  const p = (await setNotePublic(sql, n.id, true)) as VaultNote;
  assert.equal(p.publicSlug, 'attention-is-all-you-need');
  assert.ok(p.publicAt);
  await renameNote(sql, n.id, 'Transformers');
  await setNotePublic(sql, n.id, false);
  const again = (await setNotePublic(sql, n.id, true)) as VaultNote;
  assert.equal(again.publicSlug, 'attention-is-all-you-need');
  assert.equal(again.publicAt, p.publicAt);
});
test('slugs are unique, and a title without ASCII letters uses the uid', async () => {
  const a = await make('Same');
  const b = await make('same!');
  await setNotePublic(sql, a.id, true);
  assert.equal(((await setNotePublic(sql, b.id, true)) as VaultNote).publicSlug, 'same-2');
  const c = await make('یادداشت');
  const pc = (await setNotePublic(sql, c.id, true)) as VaultNote;
  assert.equal(pc.publicSlug, `note-${c.uid.slice(0, 8)}`);
});
test('a chat note cannot be public', async () => { /* make a chat note via ensureChatNote as vault-db.test.ts does */
  assert.equal(await setNotePublic(sql, chatNoteId, true), 'chat');
});
test('a paper shares at most 10 highlights', async () => {
  // 11 highlights on one paper via addHighlight
  for (const h of hs.slice(0, 10)) assert.equal(await setHighlightPublic(sql, h.id, true), true);
  assert.equal(await setHighlightPublic(sql, hs[10].id, true), 'full');
  assert.equal(await setHighlightPublic(sql, hs[0].id, false), true);
  assert.equal(await setHighlightPublic(sql, hs[10].id, true), true);
});
test('two concurrent toggles at 9 cannot both pass', async () => {
  // with 9 public, run setHighlightPublic on two others in parallel: exactly one 'full'
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm tsx --test src/lib/reading/publish-state.test.ts`. Expected:
  FAIL (`setNotePublic` is not exported / column "uid" does not exist).

- [ ] **Step 3: Write `migrations/011_public_notes.sql`** with the columns, indexes and check above (add `uid` with its
  default so existing rows get one; `create unique index … on vault_notes (uid)` and
  `… (public_slug) where public_slug is not null`). Confirm `gen_random_uuid()` works on pglite in the test run.

- [ ] **Step 4: Implement** the type fields, `toNote` mapping (`public_at` as ISO or null), the highlight mapping in
  `room-db.ts`, `publicSlug`, `setNotePublic`, `setHighlightPublic`, and the two limits.

- [ ] **Step 5: Run** `pnpm tsx --test src/lib/reading/publish-state.test.ts src/lib/reading/vault-db.test.ts
  src/lib/reading/room-db.test.ts src/lib/reading/vault-migration.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit** `git commit -m "Reading: notes and highlights can be marked public"`.

---

### Task 2: The published copy (pure)

**Files:**
- Modify: `src/lib/reading/vault-links.ts` (add `mapLinks`)
- Create: `src/lib/reading/publish.ts`
- Test: `src/lib/reading/publish.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_HIGHLIGHTS_MAX`, `PUBLIC_QUOTE_MAX` (Task 1); `pidLabel` from `src/admin/reading-room.ts`.
- Produces:
  - `mapLinks(body: string, fn: (l: { target: string; alias: string | null; heading: string | null; embed: boolean
    }) => string): string` in `vault-links.ts`: replaces every `[[…]]` the vault's `LINK` pattern matches with
    `fn(…)`; `target` whitespace-collapsed as `wikiLinks` does. Browser-safe (the site's renderer uses it too).
  - `linkKey(target: string): string`: `collapse(target).toLowerCase()`, the key `vault_links.target` uses.
  - In `publish.ts`:

```ts
export interface PublicNote {
  uid: string;
  kind: 'paper' | 'free';
  title: string; // the vault title: the [[link]] target
  body: string; // the owner's Markdown
  slug: string;
  sharedAt: string; // public_at
  updatedAt: string;
  paper?: { title: string; authors: string[]; url: string; arxiv: string | null; doi: string | null; publishedAt: string | null };
  highlights?: { pid: string; quote: string; comment: string }[]; // the public ones, in listHighlights order
}
export const COPY_DIRS = { paper: 'src/content/readings', free: 'src/content/notes' } as const;
/** `targets`: linkKey(title) → uid of every public note. */
export function publishedCopy(n: PublicNote, targets: Map<string, string>): { path: string; content: string };
export function stripPrivateLinks(body: string, targets: Map<string, string>): string;
```

  - Copy content: `---\n` + YAML (`stringify(fm, { lineWidth: 0 })`, keys in this order) + `---\n\n` + body.
    Front matter: `id` (uid), `kind` (`note` | `paper`), `title`, `shared`, `updated`, `links` (uids of public targets
    the body links to, unique, in order, self excluded), then for a paper `paper: { title, authors, url, arxiv?, doi?,
    published? }` and `highlights: [{ quote, where, comment? }]` (`where` = `pidLabel(pid)`, at most 10, each quote cut
    to `PUBLIC_QUOTE_MAX` code points as its first 299 trimmed + `…`). Body: `stripPrivateLinks(n.body, targets)`.
    The same input always gives byte-identical output (no clock reads).

- [ ] **Step 1: Write the failing tests** in `publish.test.ts`:

```ts
const targets = new Map([[linkKey('Public Idea'), 'u-pub']]);
test('links to public notes stay; private ones lose their target', () => {
  assert.equal(
    stripPrivateLinks('See [[Public Idea]], [[Secret|my alias]], [[Secret]], [[Secret#Part]], ![[Secret]].', targets),
    'See [[Public Idea]], my alias, (private note), (private note), (private note).',
  );
});
test('case and whitespace variants of a private title are stripped too', () => {
  assert.equal(stripPrivateLinks('[[ secret   NOTE ]] `[[Secret]]`', new Map()), '(private note) `(private note)`');
});
test('a link to a public note keeps its alias and heading', () => {
  assert.equal(stripPrivateLinks('[[public idea#Why|why]]', targets), '[[public idea#Why|why]]');
});
test('a free note copy: path, front matter, links', () => {
  const { path, content } = publishedCopy(freeNote({ body: 'x [[Public Idea]] [[Public Idea]] [[Secret]]' }), targets);
  assert.equal(path, 'src/content/notes/my-note.md');
  const { data, body } = parseMarkdown(content); // src/lib/admin/serialize.ts
  assert.deepEqual(data.links, ['u-pub']);
  assert.equal(data.kind, 'note');
  assert.equal(body.trim(), 'x [[Public Idea]] [[Public Idea]] (private note)');
  assert.ok(!content.includes('Secret'));
});
test('a paper copy carries metadata and at most 10 highlights, each at most 300 characters', () => {
  const long = 'a'.repeat(400);
  const { path, content } = publishedCopy(paperNote({ highlights: Array.from({ length: 12 }, (_, i) => ({ pid: 'S2.p3', quote: i ? 'q' : long, comment: '' })) }), targets);
  assert.equal(path, 'src/content/readings/paper-slug.md');
  const { data } = parseMarkdown(content);
  assert.equal(data.highlights.length, 10);
  assert.equal([...data.highlights[0].quote].length, 300);
  assert.ok(data.highlights[0].quote.endsWith('…'));
  assert.equal(data.highlights[0].where, '§2 ¶3');
  assert.equal(data.paper.url, 'https://arxiv.org/abs/1706.03762');
});
test('the same note always gives the same bytes', () => {
  assert.equal(publishedCopy(freeNote(), targets).content, publishedCopy(freeNote(), targets).content);
});
```

- [ ] **Step 2: Run** `pnpm tsx --test src/lib/reading/publish.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `mapLinks`, `linkKey` and `publish.ts`. Refactor `rewriteLinks` onto `mapLinks` only if it
  stays byte-identical (its tests must pass unchanged).
- [ ] **Step 4: Run** `pnpm tsx --test src/lib/reading/publish.test.ts src/lib/reading/vault-links.test.ts`. Expected:
  PASS.
- [ ] **Step 5: Commit** `git commit -m "Reading: the published copy of a public note"`.

---

### Task 3: `republish`: copies into `documents`

**Files:**
- Create: `src/lib/reading/publish-db.ts`
- Modify: `src/lib/admin/paths.ts` (`isDocumentPath`)
- Test: `src/lib/reading/publish-db.test.ts`

**Interfaces:**
- Consumes: Task 1 columns and `setNotePublic`, `setHighlightPublic`; Task 2 `publishedCopy`, `COPY_DIRS`,
  `linkKey`; `PostgresStore`, `PostgresDeps`, `ConflictError` (`src/lib/admin/postgres-store.ts`, `store.ts`);
  `getPapers` (`db.ts`), `listHighlights` (`room-db.ts`).
- Produces:
  - `publicNotes(sql: Sql): Promise<PublicNote[]>`: every `public` note with kind `paper` or `free`, its paper and its
    public highlights.
  - `republish(sql: Sql, deps?: PostgresDeps): Promise<{ changed: number }>`: the copies `publicNotes` gives, diffed
    against the `documents` rows under both `COPY_DIRS`; one `PostgresStore.commit` of only the changed, new and gone
    paths (author name `Vault`), with base versions from the same read. On `ConflictError` it recomputes and tries
    again, at most 3 attempts, then throws. Nothing to change → no commit.
  - `paths.ts`: `PUBLISHED = /^src\/content\/(readings|notes)\/([a-z0-9-]{1,80})\.md$/`; `isDocumentPath` returns true
    for it (so seeding, backup deletions and `db:export` cover the copies). `assertAllowed` is unchanged: nothing but
    `republish` writes them.

- [ ] **Step 1: Write the failing tests** (pglite; `deps = { purge: async (t) => purged.push(...t), put, del }` fakes):

```ts
test('publishing writes the copy; nothing else changes on a second run', async () => {
  const n = await make('My Note', 'hello');
  await setNotePublic(sql, n.id, true);
  assert.deepEqual(await republish(sql, deps), { changed: 1 });
  assert.ok(await doc('src/content/notes/my-note.md'));
  const revs = await count('revisions');
  assert.deepEqual(await republish(sql, deps), { changed: 0 });
  assert.equal(await count('revisions'), revs);
  assert.ok(purged.includes('col:notes'));
});
test('a private note never reaches documents', async () => {
  const secret = await make('Secret plan', 'private words');
  const pub = await make('Open', 'see [[Secret plan]]');
  await setNotePublic(sql, pub.id, true);
  await republish(sql, deps);
  const all = (await sql`select content from documents`).map((r) => r.content).join('\n');
  assert.ok(!all.includes('Secret plan') && !all.includes('private words'));
});
test('rename keeps the path and updates the linking copy', async () => {
  const a = await make('Alpha'); const b = await make('Beta', 'see [[Alpha]]');
  await setNotePublic(sql, a.id, true); await setNotePublic(sql, b.id, true); await republish(sql, deps);
  await renameNote(sql, a.id, 'Alpha Prime'); await republish(sql, deps);
  assert.match((await doc('src/content/notes/alpha.md'))!, /title: Alpha Prime/);
  assert.match((await doc('src/content/notes/beta.md'))!, /\[\[Alpha Prime\]\]/);
  assert.equal(await countLike('src/content/notes/%'), 2);
});
test('unpublishing or deleting a note removes its copy and its links elsewhere', async () => {
  // a, b public; b links a. setNotePublic(a,false) → a's copy gone, b's body shows '(private note)', b.links = []
  // deleteNote(c) of a public c → c's copy gone
});
test('a paper copy has only its public highlights; a private paper note has no copy', async () => {});
test('a concurrent run that loses the race recomputes', async () => {
  // run two republish calls in parallel after two different publishes: both resolve, final documents equal
  // what a fresh republish computes (changed: 0 afterwards)
});
```

- [ ] **Step 2: Run** `pnpm tsx --test src/lib/reading/publish-db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `publicNotes`, `republish`, and the `isDocumentPath` change (add a `paths.test.ts` case:
  `isDocumentPath('src/content/notes/a-b.md') === true`, `assertAllowed` still throws for it).
- [ ] **Step 4: Run** `pnpm tsx --test src/lib/reading/publish-db.test.ts src/lib/admin/paths.test.ts
  src/lib/admin/backup.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Reading: public notes are published into documents"`.

---

### Task 4: Admin API: toggles, republish after writes, Publish again

**Files:**
- Modify: `src/admin/routes/api/reading/vault/notes/[id].ts`
- Modify: `src/admin/routes/api/reading/highlights/[id].ts`
- Modify: `src/admin/routes/api/reading/notes.ts`
- Modify: `src/admin/routes/api/reading/vault/suggestions/[id].ts`
- Modify: the room's paper route that returns the room's data (`src/admin/routes/api/reading/papers/[id].ts` GET)
- Create: `src/admin/routes/api/reading/vault/publish.ts`
- Create: `src/lib/reading/visibility.ts`
- Test: `src/lib/reading/publish-routes.test.ts` (follow `src/lib/reading/routes.test.ts` for calling routes)

**Interfaces:**
- Consumes: `setNotePublic`, `setHighlightPublic` (Task 1), `republish` (Task 3), `isPageOn` (`src/lib/config.ts`).
- Produces:
  - `visibility.ts`:

```ts
export interface Visibility { noteId: number | null; public: boolean; url: string | null; pageOn: boolean; chat: boolean }
export function visibilityOf(note: VaultNote | null): Visibility; // url '/readings/<slug>/' or '/notes/<slug>/' when public
/** Runs republish; a failure is logged and returned as a sentence, never thrown. */
export async function afterVaultWrite(sql: Sql): Promise<{ publishWarning?: string }>;
/** Tests swap the republish it runs (as setApplySandboxForTests does); production code never calls this. */
export function setRepublishForTests(fn: typeof republish | null): void;
```

  - `PATCH /api/reading/vault/notes/[id]` accepts `public?: boolean` (with or without title/body). 'chat' → 400 "Chat
    notes can't be made public: they are mostly AI text." GET adds `visibility`. PATCH and DELETE responses add
    `publishWarning` when set (DELETE answers 200 `{ publishWarning }` when there is one, else 204).
  - `PATCH /api/reading/highlights/[id]` body becomes `{ comment?: string; public?: boolean }` (at least one). 'full' →
    409 "A paper shares at most 10 highlights." Responses add `publishWarning`. DELETE as above.
  - `PUT /api/reading/notes`, and accepting a suggestion, add `publishWarning`.
  - The room's paper GET adds `visibility` for the paper's note (`noteId: null` when it has none yet) and `public` on
    each highlight. Making a paper public from the room when it has no note creates it (`ensurePaperNote` under
    `withTitles`) then publishes: `POST /api/reading/vault/publish` with `{ paper: number, public: boolean }` →
    `{ visibility, publishWarning? }`; with `{}` it only runs `republish` ("Publish again") → `{ changed }` or 502 with
    the sentence.
  - `afterVaultWrite` runs after every write above (the toggles, body saves, renames, deletes, highlight comment and
    delete, suggestion accept). It is cheap when nothing is public.

- [ ] **Step 1: Write the failing route tests:** making a note public returns `visibility.url === '/notes/<slug>/'` and
  writes the copy; a chat note → 400 with the sentence; the 11th public highlight → 409 with the sentence; a body save
  of a public note updates the copy; with `republish` swapped for one that throws (`setRepublishForTests`), the save still returns 200 with `publishWarning`; `POST
  /api/reading/vault/publish {paper}` on a paper without a note creates the note and publishes it; every route
  answers 401/403 without the owner session as the other reading routes do.
- [ ] **Step 2: Run** `pnpm tsx --test src/lib/reading/publish-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and `visibility.ts`.
- [ ] **Step 4: Run** `pnpm tsx --test src/lib/reading/publish-routes.test.ts src/lib/reading/routes.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Reading: owner routes to make notes and highlights public"`.

---

### Task 5: Admin UI: the Visibility line and highlight toggles

**Files:**
- Modify: `src/admin/ReadingVaultNote.vue`, `src/admin/ReadingRoom.vue`, `src/admin/Pages.vue`
- Modify: `src/admin/vault.ts` or `src/admin/reading-room.ts` (a pure `visibilityText(v: Visibility, kind:
  'paper' | 'free', shared?: { on: number; all: number }): string` for testing)
- Test: `src/admin/vault.test.ts` (or `reading-room.test.ts`), and one Playwright case in `tests/e2e` if the vault
  editor already has one there

**Interfaces:**
- Consumes: Task 4's routes and `Visibility`.
- Produces: exact copy:
  - Private: `Visibility: private.` + button **Make public**.
  - Chat note: `Visibility: private. Chat notes can't be made public.` (no button).
  - Public free note: `Visibility: public at /notes/<slug>/.` (the path a link opening the public page in a new tab)
    + button **Make private**.
  - Public paper: `Visibility: public at /readings/<slug>/, with N of M highlights.`
  - Page off (`pageOn` false), appended: ` The Notes page is off; turn it on in Pages.` / ` The Readings page is off;
    turn it on in Pages.` ("Pages" links to the admin Pages screen).
  - `publishWarning` present: `Saved, but the public copy didn't update: <warning>` + button **Publish again**.
  - Each highlight in the reading room gets a **Public** checkbox (off by default) with the hint `Shown publicly up to
    300 characters.`; a 409 shows its sentence beside the highlight.
  - Pages.vue: the `readings` and `notes` switches default to off (`default: false`) with the hint `Off until you turn
    it on. Add it to the menu under Settings → Menu items.`

- [ ] **Step 1: Write the failing test** for `visibilityText` covering the five states above with exact strings.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `visibilityText` and wire the line, buttons and toggles into both screens and Pages.vue.
  Toggling updates from the response's `visibility` (no refetch), and a failed toggle restores the previous state.
- [ ] **Step 4: Run** the unit test, `pnpm check`, and drive the vault editor in the browser (`pnpm dev` with
  `scripts/dev-postgres.ts`): make a note public, see the line change, make it private. Expected: PASS, and the copy
  appears/disappears in `documents`.
- [ ] **Step 5: Commit** `git commit -m "Admin: a Visibility line on notes and papers, and public highlights"`.

---

### Task 6: Site content: the collections, the page switches and the loader

**Files:**
- Modify: `src/lib/schemas.ts` (`readingsSchema`, `notesSchema`), `src/content.config.ts`,
  `src/lib/content/documents.ts` (`documentSchemas`)
- Modify: `src/lib/types.ts` (`SITE_PAGES`), `src/lib/config.ts` (`isPageOn`), `src/lib/content/sitemap.ts`
- Create: `src/content/readings/.gitkeep`, `src/content/notes/.gitkeep` (if the empty glob needs a directory)
- Create: `src/lib/public-notes.ts`
- Test: `src/lib/public-notes.test.ts`, `src/lib/config.test.ts` (or wherever `isPageOn` is tested)

**Interfaces:**
- Consumes: the copy format (Task 2), `mapLinks`, `linkKey` (Task 2), `renderMarkdownDocument` (`src/lib/markdown.ts`).
- Produces:
  - Schemas (strict about types, `shared`/`updated` as `z.coerce.date()` so YAML timestamps parse in every mode):
    `notesSchema = { id: string uuid, kind: 'note', title, shared, updated, links: string[] }`,
    `readingsSchema = { …same with kind 'paper', paper: { title, authors: string[], url (http/https), arxiv?, doi?,
    published? }, highlights: { quote, where, comment? }[] }`.
  - `SITE_PAGES` gains `readings: '/readings'`, `notes: '/notes'`. `DEFAULT_OFF: SitePageId[] = ['readings', 'notes']`
    exported from `types.ts`; `isPageOn` treats a missing setting as off for these two only.
  - `sitemap.ts` `ENTRY_ROUTES` gains `['readings', '/readings']`, `['notes', '/notes']`.
  - `public-notes.ts`:

```ts
export interface PublicEntry { id: string /* slug */; kind: 'note' | 'paper'; data: NotesData | ReadingsData; body: string; url: string }
export async function loadPublic(): Promise<PublicEntry[]>; // both collections, only those whose page is on
/** [[T|a]] → [a](url) when T names a public entry (linkKey), else the shown text; then rendered. */
export async function renderPublicBody(e: PublicEntry, all: PublicEntry[]): Promise<string>;
export function backlinksOf(e: PublicEntry, all: PublicEntry[]): PublicEntry[]; // entries whose links include e.data.id, by title
export function publicGraph(all: PublicEntry[]): { nodes: { id: string; title: string; kind: 'paper' | 'free'; links: number; href: string }[]; edges: [number, number][] };
export function excerpt(markdown: string, max = 280): string; // plain text, wikilinks as their shown text
```

- [ ] **Step 1: Write the failing tests:** `isPageOn('/notes', { pages: {} })` false, `isPageOn('/notes/x/', { pages:
  { notes: true } })` true, `isPageOn('/blog', { pages: {} })` still true; `renderPublicBody` turns `[[Alpha|a]]` into
  a link to `/notes/alpha/` and `[[Gone]]` into the text `Gone` (a copy can be one republish behind); the shown text
  is escaped (`[[Alpha|a]b]]` can't open a second link); `publicGraph` counts links both ways and drops edges to
  unknown uids; `excerpt` cuts at 280 with `…`; parsing a Task 2 copy through `parseDocuments('notes', …)` succeeds.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Verify `pnpm build` (static) succeeds with both collections empty.
- [ ] **Step 4: Run** `pnpm test` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Site: readings and notes collections, off until turned on"`.

---

### Task 7: The pages and the graph island

**Files:**
- Create: `src/pages/readings/index.astro`, `src/pages/readings/[slug].astro`, `src/pages/notes/index.astro`,
  `src/pages/notes/[slug].astro`
- Create: `src/themes/editorial/Readings.astro`, `Reading.astro`, `Notes.astro`, `Note.astro`; the same four in
  `src/themes/classic/` (using `PageShell.astro`)
- Create: `src/components/vue/NoteGraph.vue`; Modify: `src/admin/ReadingVaultGraph.vue` to use it
- Modify: `scripts/check-themes.mjs` only if its structural mode must learn the new pages
- Test: a Playwright case in `tests/e2e` for the public Notes page graph (keyboard: Tab walks titles, Enter opens)

**Interfaces:**
- Consumes: `loadPublic`, `renderPublicBody`, `backlinksOf`, `publicGraph`, `excerpt` (Task 6; `publicGraph`'s kind
  `free` is a copy's kind `note`, matching the admin graph's names); `layout`,
  `nearestNode` (`src/admin/vault.ts`, pure).
- Produces:
  - Routes follow `src/pages/blog/[id].astro` (`getStaticPaths` + `staticProps`, 404 when absent) and pick the theme
    component by `getTheme()`.
  - **Readings** index: newest `shared` first; each item: paper title (link to its page), authors · published date,
    a **Source** link (`paper.url`), the note's `excerpt`, `N highlights`. Empty: `Nothing shared yet.`
  - **Reading** page: title, authors, date, Source link (and arXiv / DOI links when present), the owner's note
    (`renderPublicBody`) under the heading `Notes`, then `Highlights`: each quote in quotation marks, its `where`, and
    its comment, styled as the paper's words. Backlinks: `Linked from` list when any.
  - **Notes** index: the graph (`<NoteGraph client:visible …>` with `publicGraph` data) when there is at least one
    edge, then every public note by title (papers listed on Readings, not here). Empty: `Nothing shared yet.` Footer
    line: `Download these notes for Obsidian` → `/notes/vault.zip`, and `graph.json` → `/notes/graph.json`.
  - **Note** page: title, updated date, body (`renderPublicBody`), `Linked from` backlinks.
  - `NoteGraph.vue` props: `{ nodes: { title: string; kind: 'paper' | 'free' | 'chat'; links: number; href: string
    }[]; edges: [number, number][] }`: the drawing, labels, selection, phone sizing and keyboard behaviour lifted from
    `ReadingVaultGraph.vue` unchanged, its styles scoped and driven by CSS custom properties that the admin and both
    themes set. `ReadingVaultGraph.vue` keeps loading, totals and the admin strip, and renders `NoteGraph`.
  - Titles and bodies are rendered as text or through the Markdown renderer only, never as raw HTML from front matter.

- [ ] **Step 1: Write the failing e2e case** (public notes page with two linked copies seeded into the fixture
  content): the graph shows two nodes; Tab focuses titles alphabetically; Enter opens the note page.
- [ ] **Step 2: Run** `pnpm test:e2e -g "public notes"`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes, the eight theme components and `NoteGraph.vue`; the admin vault graph must look
  and behave as before.
- [ ] **Step 4: Run** `pnpm test:e2e`, `pnpm check:themes --structural`, and screenshot `/readings`, a reading,
  `/notes` and a note in both themes at desktop and phone widths (with `pages: { readings: true, notes: true }` and a
  few fixture copies). Expected: PASS; pages readable, no horizontal scroll on phones.
- [ ] **Step 5: Commit** `git commit -m "Site: public Readings and Notes pages, with the notes graph"`.

---

### Task 8: `graph.json` and `vault.zip`

**Files:**
- Create: `src/pages/notes/graph.json.ts`, `src/pages/notes/vault.zip.ts`
- Modify: `src/lib/public-notes.ts` (`graphDocument`, `publicZipFiles`)
- Test: `src/lib/public-notes.test.ts`

**Interfaces:**
- Consumes: `loadPublic` (Task 6), `zip` (`src/lib/reading/vault-zip.ts`), `EXPORT_MAX` (`vault-db.ts`),
  `getSiteConfig`, `getSiteName`.
- Produces (the format Part 2's importer reads; keep it exactly):

```ts
export interface GraphDocument {
  format: 'scholaros-notes';
  version: 1;
  site: { name: string; url: string; owner: string }; // getSiteName(), config.siteUrl (no trailing slash), config.author
  notes: {
    id: string; kind: 'note' | 'paper'; title: string; url: string /* absolute */; shared: string; updated: string;
    body: string; // the copy's body: [[links]] to public notes only
    paper?: { title: string; authors: string[]; url: string; arxiv?: string; doi?: string; published?: string };
    highlights?: { quote: string; where: string; comment?: string }[];
  }[];
  links: [string, string][]; // [from id, to id], each once, both ends present in notes
}
export function graphDocument(all: PublicEntry[], site: GraphDocument['site']): GraphDocument; // notes by title, links sorted
export function publicZipFiles(all: PublicEntry[], siteUrl: string): { path: string; text: string; date: Date }[];
```

  - `vault.zip` files: `notes/<title>.md` and `readings/<title>.md` (title = the vault title, so `[[links]]` resolve in
    Obsidian), text = the copy's front matter plus `source: <absolute public url>`, then its body. Over `EXPORT_MAX`
    → 413 with the vault export's sentence.
  - Both routes: `prerender` like the pages (static in static/git mode, on request in Postgres mode, cached under
    `col:readings` and `col:notes`), 404 when the Notes page is off. Headers: `application/json; charset=utf-8`;
    `application/zip` with `Content-Disposition: attachment; filename="<site name> notes.zip"` (ASCII-safe fallback
    name as the vault export route uses).

- [ ] **Step 1: Write the failing tests:** `graphDocument` of three copies (one paper, two notes, one link between the
  notes and one dangling link to an unknown uid) gives `version: 1`, absolute URLs, the paper's highlights, and
  exactly one link; a `publicZipFiles` round-trip through `unzip` (`test-unzip.ts`) gives the two folders and the
  `source:` line; an over-cap zip is refused with 413.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the functions and the two routes. Check in a static build that `/notes/graph.json` is
  written when notes is on, and that the middleware answers 404 for it when off.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Site: the public notes as graph.json and an Obsidian zip"`.

---

### Task 9: Docs and final verification

**Files:**
- Modify: the docs page that describes Reading and the vault (find it under `docs/`, as the reading-room Built notes
  did), `config/site.yml` comments for `pages:` if it lists page ids
- Modify: `docs/superpowers/specs/2026-10-23-public-notes-and-demo-design.md` (a `Built` note under Part 1: what
  shipped, and any rulings)

- [ ] **Step 1: Document** how to make a note or paper public, what is and isn't public, the two page switches, the
  menu item, `graph.json` and `vault.zip`.
- [ ] **Step 2: Run the full verification:** `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`,
  `VERCEL=1 VERCEL_DEPLOYMENT_ID=dpl_local DATABASE_URL=postgres://x:y@127.0.0.1:1/z pnpm build`,
  `pnpm check:themes --structural`, `pnpm test:e2e`. Expected: all exit 0.
- [ ] **Step 3: Privacy sweep:** on a local Postgres with a mix of private and public notes (private titles containing
  a marker string such as `ZZPRIVATE`), fetch `/readings`, every reading, `/notes`, every note, `/notes/graph.json`,
  `/notes/vault.zip` (unzipped) and `select content from documents`; the marker appears in none.
- [ ] **Step 4: Commit** `git commit -m "Docs: public Readings and Notes"`.
