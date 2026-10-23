# Public readings and notes, sharing and imports, and a public demo

Date: 2026-10-23 · Status: draft for approval

## Intent

ScholarOS is mainly the owner's own site, but the owner wants it to be visible and adoptable by other researchers. Most
of what makes it different (the digest, the reading room, the vault, the job search) lives behind the admin login,
where no visitor sees it. This work makes the best of it visible, in two ways:

- **On the owner's site.** Public **Readings** and **Notes** pages show what the owner chooses to share: papers with
  their notes and highlights, their own notes, and a graph of how those notes connect. Other researchers can pick notes
  from that public graph and import them into their own ScholarOS vault, with a link back. An Obsidian user can bring
  their vault in, and later a ScholarOS plugin for Obsidian will keep the two in sync.
- **A public demo.** A separate deployment with a made-up researcher. Anyone can sign in with one click and use every
  feature. AI is simulated, nothing real is sent, and the demo resets every night.

The parts, in build order:

1. **Public Readings and Notes.** Per-item public toggles, two public pages, the public graph, stable links, and an open
   machine-readable copy of the public graph.
2. **Imports.** An Obsidian vault (zip) into the vault, and picked notes from another ScholarOS site's public graph.
3. **The demo deployment.**
4. **Later: the ScholarOS plugin for Obsidian** (sign-in and two-way sync). Designed here so parts 1–2 leave the right
   hooks. Not built in this round.

## Goals

- The owner decides, item by item, what is public. Nothing is public by default.
- A visitor on **Readings** sees papers with the owner's public note and shared highlights, linked to the source. On
  **Notes** they see the owner's public notes and a graph of the links between public notes, and can open any note.
- Every public note and paper has a stable address that can be shared.
- Another ScholarOS owner can paste a site address, see that site's public graph, pick all of it or part of it, and
  import those notes into their own vault. Each imported note says where it came from and links back.
- An Obsidian user can import their vault as a zip: notes, front matter and `[[links]]` come in intact.
- The public graph is also offered as an Obsidian-ready download, for people without ScholarOS.
- A researcher clicking through from a launch post reaches a demo where they can try every feature within minutes,
  with sample data already in place.

## Non-goals (this round)

- The Obsidian plugin itself (part 4). This round only keeps the door open for it.
- Live following of another site (subscriptions, update feeds). Imports are one-time copies.
- Comments, likes, or any visitor accounts on the public pages.
- Importing Obsidian attachments (images, PDFs, canvases). Notes only; skipped files are counted and listed.
- Making AI output public. Summaries, findings, study aids and chat answers stay private.

## Anti-goals (a failure even if it technically works)

- **Leaking private material.** A private note's title or text must never appear on a public page, in the public graph
  or in its machine-readable copy, including through a link from a public note. A link to a private note renders as
  plain text.
- **Passing AI text off as the owner's.** Public pages show only the owner's own writing, paper metadata, and short
  highlighted lines clearly marked as the paper's words.
- **Republishing papers.** No full paper text is ever public. Highlights stay short, as they are today.
- **An import that loses or mangles writing.** Imported notes keep their text, front matter and links exactly. An import
  never overwrites one of the owner's existing notes.
- **A demo that costs money or can be abused.** No real AI calls, no real email, no real job applications, no
  outbound requests to third parties beyond fetching public papers, no real secrets in the demo deployment.
- **A demo that can touch the owner's real site.** It has its own project, database and storage; demo mode can never be
  switched on by accident on a real site.

## Existing system (what this builds on)

- **Rendering by mode.** Static mode (the owner's GitHub Pages copy) builds from git content. Git mode on Vercel
  prerenders from the repo. Postgres mode renders every page on request from the `documents` table, cached by tag.
  Public pages are `src/pages/*` routes that pick a theme component (`src/themes/editorial|classic`). A new public page
  needs a `SITE_PAGES` entry (so it can be turned on or off, appears in the nav and sitemap), a route and theme
  components.
- **Content collections** are globbed from `src/content/<dir>`; in Postgres mode `getEntries` reads the same paths from
  `documents`. `backupToGit` mirrors `documents` to the `content-backup` branch; `db:export` writes them to disk.
- **The vault** (`vault_notes`, `vault_links`, migration 010) is owner-only and kept out of `documents`. Paper notes
  render their generated parts at read time; the owner's text, highlights and chat snapshots are stored.
- **Auth** is a sealed session cookie, with an Origin check on every mutating admin request. There is no token auth for
  non-browser clients.
- **Seams for a demo.** AI goes through `generateText`, `generateImage`, `generateAnimation` and `missingAiKey`
  (`src/lib/admin/ai.ts`), with a few direct reads of `TEXT_PROVIDERS[...].keys`. Vercel Sandbox, Resend
  (`sendEmail`) and outbound fetching (`getText`/`getBytes`/`getJson`) each have one module. The daily cron runs
  `dailySteps`; `/api/admin/cron/*` is reachable without a session but needs `CRON_SECRET`.
- **Sample persona.** The repo already ships "Prof. Jane Smith" with publications, posts, people, talks and projects.
  There is no sample reading, vault or job-search data.
- **Fetch guard.** `getJson` refuses private hosts, re-checks redirects, and caps time and size.

## Part 1: public Readings and Notes

### What the owner marks public

- **A paper.** Public means the paper appears on Readings with its title, authors, venue and date, a link to the source,
  the owner's note on it (their own text only), and the highlights the owner shares. Each highlight has its own public
  toggle, off by default. A public highlight shows at most 300 characters of the paper's words, at most 10 public
  highlights per paper, and its comment (the owner's writing) is public with it.
- **A free note.** Public means it appears on Notes and in the public graph.
- **Chat notes** cannot be made public (they are mostly AI text).
- The toggles live in the vault editor and the reading room. A Visibility line on each note says what is public.

### How public items reach the site (my call, see below)

Making an item public writes a **published copy** into `documents` as ordinary site content, under
`src/content/readings/<slug>.md` and `src/content/notes/<slug>.md`: Markdown with front matter, the same shape the vault
exports. Saving a public note updates its copy. Making it private deletes the copy.

This makes public items behave exactly like posts: they render in Postgres mode, go into the git backup and
`db:export`, can be committed for static builds, and never require public routes to read private tables. Private vault
data still never enters `documents`.

In the published copy, links to public notes point at their public pages. A link to a note that is not public loses
its target: `[[Private title|shown text]]` keeps only "shown text", and `[[Private title]]` with no alias becomes
"(private note)", so a private title never appears.

**Stable addresses.** A note's public address is fixed when it is first published and kept through renames; the stable
id in `graph.json` is a UUID added to each vault note, not its title.

### The pages

- **Readings** (`/readings`): public papers, newest first, each with its note and highlights. A page per paper
  (`/readings/<slug>`).
- **Notes** (`/notes`): the public graph at the top, then public notes listed by title. A page per note
  (`/notes/<slug>`), with its public backlinks.
- Both are `SITE_PAGES` entries, off until the owner turns them on, and themed for both editorial and classic.
- The graph reuses the vault's force layout and drawing, read-only, with the same phone and keyboard behaviour.

### The open copy (for sharing and import)

- `/notes/graph.json`: a versioned document describing the public graph: the site (name, URL, owner name), and each
  public note and paper with a stable id, title, kind, updated time, public URL, Markdown body, source-paper metadata
  and shared highlights, plus the links between them.
- `/notes/vault.zip`: the same public notes as an Obsidian-ready folder, built like the vault export.
- Both are generated from the published copies only.

### Built (2026-10-23)

Part 1 shipped as planned in `docs/superpowers/plans/2026-10-23-public-readings-notes.md`. Decisions made while
building it:

- **What is stored:** migration 011 adds `vault_notes.uid` (a UUID, the id `graph.json` uses), `public`, `public_slug`
  and `public_at` (both fixed at first publish and kept after unpublishing), a check that a chat note is never public,
  and `reading_highlights.public`. Paper metadata is what `reading_papers` holds: title, authors, URL, arXiv id, DOI and
  date. There is no venue field, so no venue is shown.
- **One republish for every vault write:** `republish` builds every public note's copy and brings `documents` under
  `src/content/readings|notes/` to exactly that set in one commit of the differences, retrying from fresh reads when it
  loses a race; nothing changed commits nothing, so autosave doesn't churn the history. A failed republish never fails
  the save: the response carries `publishWarning` and the admin offers Publish again. The copies are written only by
  `republish` (`PUBLISHED` is a document path but not in the write allowlist), so the AI site editor can't edit them:
  they would be rewritten from the vault.
- **Private links:** a link to a note that isn't public keeps its alias or reads "(private note)", in the body, a
  highlight's quote and its comment, repeated until nothing changes (an alias can hold the pieces of another link).
  The copy keeps `[[links]]` to public notes, the shape the vault exports; the site turns them into links by title.
- **db-seed does not seed the copies:** they derive from the vault, and the next republish would delete them in a
  database whose notes aren't public. A fresh database starts with no copies until the owner saves a public note or
  presses Publish again.
- **The Visibility line:** "Visibility: public at <url>, with N of M highlights." with Make public / Make private, on
  vault notes and in the paper and notebook rooms. It reads the page switches through the store, since admin routes
  run outside the request context that `getSiteConfig()` needs in Postgres mode. The page-off hint ("The Readings page
  is off; turn it on in Pages.") shows only on public items: on a private one it says nothing useful. The
  300-character hint shows once above the highlight list, tied to each Public box by `aria-describedby`, not repeated
  per row.
- **Pages off until turned on:** `readings` and `notes` are `DEFAULT_OFF` `SITE_PAGES` entries, where absent means off.
  Turning one on adds no menu item; the switch's hint points to Settings → Menu items.
- **A public note's body renders as a post's does,** Markdown and raw HTML, through the same renderer.
- **The graph:** the vault graph's layout and drawing moved into `src/components/vue/NoteGraph.vue`, used read-only by
  `/notes` and by the vault. There is no Playwright case for the public graph: the e2e suite runs on the repo's own
  content and `site.yml`, which must not ship sample copies or the pages turned on. It was covered by a manual browser
  pass with temporary, uncommitted copies in both themes at desktop and phone widths.
- **The open copy:** `graph.json` is `format: scholaros-notes`, `version: 1`; it includes papers only while Readings is
  on, and both it and the zip answer 404 while Notes is off. The zip is named `<site>-notes.zip` (the site name's slug,
  else `site`); the vault export had no site-name precedent. `EXPORT_MAX` moved to `src/lib/reading/limits.ts`, so the
  public routes don't import the vault's database module.

## Part 2: imports

### From Obsidian

- The owner uploads a vault zip in the vault. Notes (`.md`) come in with their front matter and `[[links]]` intact;
  folders are kept as a `folder` field in front matter (the vault is flat); other files are skipped and listed.
- **Where front matter lives.** A new `meta` jsonb column on vault notes holds a note's own front matter (Obsidian's,
  `folder`, an import's `source`). The body stays clean for the editor and AI. On export and sync, `meta` is merged
  with the front matter ScholarOS generates, so an imported note comes back out with its original fields.
- Titles that clash with existing notes get the vault's usual numbering, and links inside the import follow the rename.
- Vercel caps request bodies at 4.5 MB, so the zip is read in the browser and the notes are sent in batches (builder's
  call on the details).
- An import is one undoable unit: a summary lists what came in, and "Undo this import" removes exactly those notes.

### From another ScholarOS site

- The owner pastes a site address (or one note's address). The server fetches that site's `/notes/graph.json` through
  the fetch guard and shows its public graph and list.
- The owner picks the whole graph, single notes, or a note with its neighbours, and imports. Each imported note keeps its
  text and links, gets a `source` block in front matter (site name, site URL, original URL, imported date), and shows
  "From <name>" with a link back.
- Imports are copies the owner owns and can edit. Re-importing the same note offers "Import again as a new note" or
  skip; it never overwrites.
- Imported text is third-party: it is fenced as untrusted wherever AI reads it (link suggestions, drafts), and it is not
  public unless the owner makes it public, in which case the attribution stays on the public page.

## Part 3: the demo deployment

- **Separate everything.** Its own Vercel project, Postgres database and Blob store, with no real secrets. It runs the
  normal ScholarOS code with demo mode on.
- **Demo mode** is switched on by an environment variable and a matching `site.yml` setting; both must be present, so it
  can't be turned on by accident. It is shown as a banner on every admin screen: "Demo: AI is simulated and everything
  resets every night."
- **Sign-in.** A "Try the admin" button signs a visitor in as the demo owner without a password. All visitors share
  that one owner (owner's decision): they can see each other's admin changes until the nightly reset.
- **Public pages pinned to the seed** (owner's decision). The demo's whole public site, including Readings, Notes,
  `graph.json` and `vault.zip`, always shows the sample researcher. Visitors can change anything in the admin,
  including the public toggles, but nothing they do appears on a public page. Where the admin would normally say
  "published", the demo says "In the demo, public pages always show the sample researcher." How the pin is enforced is
  the builder's call; serving the public site from the seed rather than from live writes is one way.
- **Sample data.** A made-up researcher with a full site, several weeks of digests, papers with pre-written summaries,
  study aids and chats, a linked vault with public Readings and Notes, job-search postings with tailored drafts and a
  pre-filled application, all generated once and stored as a seed. The seed is produced by one real AI run on the
  owner's OpenAI key when the demo is built (owner approved). Its papers are real arXiv papers under an open licence
  (CC-BY or more permissive), so storing their text in the demo is allowed.
- **Simulated AI.** A demo provider behind the existing AI seam answers every AI request immediately without calling
  any service. For seeded inputs it returns the pre-written output. For anything new it builds a plausible answer from
  the input itself (for example, a summary assembled from the paper's own passages with real citations), labelled
  "Demo answer". Images use stock sample images.
- **Fenced off.** Email is never sent. Job applications never reach a real employer: pre-fill and submit run against the
  built-in sample forms through a simulated runner (no Vercel Sandbox). Outbound fetches are limited to public paper
  sources; job-search sources use sample listings.
- **Nightly reset.** A cron step restores the database and storage to the seed. Uploads are size-limited.
- **Abuse limits.** Per-visitor rate limits on writes and uploads.

## Part 4 (later): ScholarOS plugin for Obsidian

Not built this round. Parts 1–2 must leave these hooks:

- Every vault note has a stable id and an updated time (already true) and keeps its folder.
- Personal access tokens for non-browser clients: created and revoked by the owner in Settings, scoped to the vault,
  accepted only on vault sync routes, exempt from the Origin check only on those routes.
- A sync API: changes since a cursor, and upserts that carry the version they were based on so conflicts are detected
  rather than overwritten.

## Constraints the builder must respect

- Nothing private reaches a public page, `graph.json`, `vault.zip`, `documents`, the git backup or `db:export`, except
  the published copies of items the owner marked public.
- Public pages work in Postgres mode and from committed content in static and git modes.
- The fetch guard for every outbound request; imported JSON validated strictly at the boundary.
- Owner-only, Postgres-only admin routes, as for the rest of Reading.
- Demo mode can never activate on a real site and never holds real secrets.
- Same Workflow bundling rule as before; final verification includes the Vercel-style build with
  `VERCEL_DEPLOYMENT_ID` set.
- Never write to a Vercel preview of the owner's site (it shares the production database). Creating the demo project and
  its storage is an outward action: the owner does it, or approves it.

## Calls made by Claude (not explicitly decided by the owner)

- Public items reach the site as published copies in `documents` (ordinary content), not by public routes reading the
  vault. This also covers the owner's static Pages copy the same way posts are covered.
- Public pages at `/readings` and `/notes`, off until turned on. The graph sits on the Notes page.
- Per-highlight public toggles, off by default. Chat notes and all AI text stay private.
- The open format is a versioned `graph.json`, plus an Obsidian-ready `vault.zip`.
- Obsidian import is notes only; folders become a front-matter field; attachments are skipped and listed; an import can
  be undone as a unit.
- Imports from other sites are one-time copies with attribution, never overwrite, and are untrusted for AI.
- Links to private notes keep only an alias, else "(private note)". Public addresses are fixed at first publish; a UUID
  is each note's stable id.
- Public highlights: at most 300 characters and 10 per paper; their comments are public with them.
- A note's own front matter is stored in a `meta` jsonb column and merged on export.
- Demo: separate project, env + config switch, one-click sign-in, simulated AI that answers from seeded outputs or from
  the input itself, simulated application runner, nightly reset, per-visitor limits. Seed papers are CC-BY arXiv papers.
- The plugin's token auth and sync API are designed now and built later.
