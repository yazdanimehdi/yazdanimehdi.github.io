# Paper digest, reading room, vault, and blog from a paper

Date: 2026-10-22 · Status: draft for approval

## Intent

Every morning the owner opens the admin and finds a short list of papers worth their time, chosen for them. The list
has two kinds of paper. First, papers people are talking about: hyped work gaining traction in the owner's wider area,
even if it is not their niche. The owner's example was a paper they found through a LinkedIn post: not directly their
field, but about LLMs, and worth knowing. Second, the day's new preprints that are close to the owner's own research.

Each paper opens into a reading room that helps the owner read and understand it, in the style of NotebookLM:

- a quick summary and the key findings first;
- chat grounded in the paper, where every answer points to the passage it came from;
- study aids;
- several papers in one notebook.

What the owner learns goes into a vault: linked Markdown notes, Obsidian-style, that grow into a web of papers and ideas
over time and can be exported. A paper or a set of notes can become a draft blog post.

ScholarOS is a forkable template used by researchers in any field. Nothing assumes ML or LLMs: the owner's field and
wider area come from their own profile, the sources follow the field, and everything is set in the admin.

Four projects, built in this order. Each is useful on its own and builds on the one before.

1. **Nightly digest.** Find, rank and show the papers.
2. **Reading room.** One page per paper (and per notebook): summary, key findings, grounded chat, study aids.
3. **Vault.** Linked Markdown notes, a graph of connections, export as an Obsidian vault.
4. **Blog from a paper.** Draft a post from a paper, a notebook or notes, into the existing blog editor.

## Goals

- A digest every day: a few talked-about papers in the owner's wider area, and the day's new papers close to their field,
  each with a line on why it is there. The why is a real signal ("312 upvotes on Hugging Face in two days", "cited 40
  times in its first month") or a concrete link to the owner's work ("close to your MIRAGE paper").
- The owner's field and wider area are worked out from the site's own data (research areas, publications, CV), shown in
  plain words in settings, and editable.
- Opening a paper gives a summary and key findings. For digest papers the text is already fetched overnight, so only the
  summary is made on open; the page shows progress while it runs (tens of seconds is acceptable, a blank page is not).
  Chat answers questions about the paper and how it relates to the owner's work, and cites the passages it used.
- Notes the owner keeps become Markdown files with links to papers and to each other; the vault exports as a folder
  Obsidian opens as is.
- A draft post from a paper lands in the blog editor as an unpublished draft, in the owner's voice, citing the paper.

## Non-goals (for now)

- Audio overviews (NotebookLM's podcast). The owner was asked which NotebookLM parts they use and said "that's it for
  now", so the reading room ships without audio. It can come later.
- Recommending papers to site visitors. The digest and everything after it is private to the owner.
- Two-way sync with an Obsidian vault on disk (import, live sync). Export only.
- Reading papers behind paywalls. Open sources only; the owner can upload a PDF they have access to.
- Static and git modes. This needs the database and the daily cron, so it is Postgres mode only and hidden elsewhere,
  like the job search.

## Anti-goals (a failure even if it technically works)

- **Invented hype.** A paper is never "talked about" because a model said so. Every traction claim shows a number from a
  named source. When a field has little open traction data, the list is shorter and says why; it is never padded.
- **Unsupported claims about a paper.** Summaries, key findings, study aids and chat answers cite the passages they rest
  on. Something the model cannot point to in the text is labelled as background, or not said.
- **A firehose.** The digest is short enough to read over coffee. Defaults: up to 5 talked-about, up to 8 in-field.
- **Republishing other people's papers.** Full paper text is cached privately for reading and grounding only. It is never
  put on the public site, in the backup, or in the vault export. Exports and posts hold the owner's notes, metadata,
  short quotes and links.
- **Leaking private reading.** Like the job search, all of it is owner-only and kept out of the `documents` table, so the
  git backup and `db:export` never see it.

## Existing system (what this builds on)

- **Paper sources.**
  - `src/lib/admin/paper-sources.ts` parses arXiv, DataCite, Crossref, bioRxiv, PubMed and OpenAlex records into
    `PaperRecord`.
  - `src/lib/admin/paper-complete.ts` has `paperLookup`, which paces calls per host (arXiv one per 3 s, NCBI 340 ms).
  - Both only look up known papers. Nothing searches for new ones yet.
- **AI.** `generateText(store, config, input)` (`src/lib/admin/ai.ts`) works over the configured provider (Claude,
  OpenAI, Gemini) and accepts PDFs (`TextInput.pdf`). There is no streaming, no embeddings, and no chat UI yet. Prompt
  helpers `jsonObject` and `UNTRUSTED` are in `src/lib/career/prompts.ts`.
- **Owner profile.**
  - `config/research.yml` has `areas[]` with titles, descriptions, tags and publications.
  - Publications are in `src/content/publications`.
  - CV text comes from `cvText` (`src/lib/career/profile.ts`).
  - In Postgres mode all of these are rows in `documents`. Career's `suggest.ts` already derives preferences from them.
- **Template to copy: the job search.**
  - Gating: owner-only routes (`careerRoute`, `isOwner`).
  - Storage: its own tables (`migrations/005_career.sql`) with a one-row settings table, and zod settings with
    lenient/strict parsing (`src/lib/career/settings.ts`).
  - Nightly work: a Workflow SDK run started from the daily cron (`src/lib/admin/jobs.ts`, `startNightly`).
  - Email: a Resend digest (`src/lib/career/digest.ts`).
  - UI: a run strip, list and detail pages in the admin's Career group.
- **Fetching.** `getText`/`getBytes` (`src/lib/career/sources/http.ts`) refuse private hosts, time out after 15 s and cap
  responses at 5 MB. `guardPosting` (`src/lib/career/guard.ts`) turns HTML into text and flags hidden text.
- **Blog.** `PostEditor.vue` saves through `collections/posts/<slug>`. `paperPostPrompt`/`parsePaperPost`
  (`src/lib/ai/prompts.ts`) already draft a post about the owner's own newly imported papers.
- **Postgres full-text search** (`tsvector`) is built in and needs no new dependency.

## What the sources can and cannot do (checked 2026-10-22)

Talked-about (traction):

| Source | Fields | Signal | Access |
| --- | --- | --- | --- |
| Hugging Face Daily Papers `huggingface.co/api/daily_papers` | ML only | upvotes, comments, `sort=trending`, by day/week/month | no auth |
| OpenAlex `api.openalex.org/works` | every field | `cited_by_count`, `counts_by_year`; filter by topic/subfield/field and date | free key (verified email) gives $1/day; without a key, callers on the same IP share $0.10/day |
| Bluesky `api.bsky.app/xrpc/app.bsky.feed.searchPosts` | every field | posts mentioning a paper's arXiv URL or DOI | no auth (answered 200 on 2026-10-22); rate limits not confirmed |
| alphaXiv `api.alphaxiv.org/papers/v3/feed` | arXiv, mostly ML | visits over 7 days, votes | undocumented, no terms; brittle |
| Semantic Scholar | every field | citation counts, no velocity | anonymous pool rate-limited (429s seen); key form |

Dead or closed: Papers with Code (shut down July 2025, now redirects to Hugging Face); Crossref Event Data (sunset 23
April 2026); Altmetric (key required since November 2025, free tier unconfirmed); Reddit (OAuth and commercial terms).

New today:

- **arXiv RSS** `rss.arxiv.org/rss/<category>` lists the day's announcements. At most one request every 3 s.
- **bioRxiv and medRxiv** `api.biorxiv.org/details/<server>/<from>/<to>/<cursor>?category=` return 30 per page. No auth.
- **PubMed E-utilities** `esearch` with `datetype=edat` and a date range, then `esummary`/`efetch`. 3 requests per second
  without a key.

Full text:

- **arXiv HTML** `arxiv.org/html/<id>v<n>` has sections and paragraphs. Some new papers have no HTML version and return
  404.
- **arXiv PDF** works as a fallback. `robots.txt` allows `/pdf` and `/html` with `Crawl-delay: 15`.
- **bioRxiv** full text and JATS are blocked to server fetches (Cloudflare 429/1015). Use the abstract and link out.

## Project 1: nightly digest

### Who the digest is for (admin → Reading → Settings)

- **Field.** A few sentences on what the owner works on, plus keywords. This drives the in-field list.
- **Wider area.** Their discipline, one level up, such as "machine learning" or "neuroscience". This drives the
  talked-about list.
- **Suggest from my profile.** An AI step reads research areas, publications and CV, like career's `suggest.ts`. It fills
  in the field, the wider area, and the source settings below. The owner reviews and saves.
- **Sources, each a toggle with its own settings:**
  - arXiv categories (e.g. `cs.CL`, `cs.LG`);
  - bioRxiv/medRxiv categories;
  - a PubMed query;
  - OpenAlex field/subfield ids (picked by name);
  - Hugging Face trending (suggested on only when the wider area is ML/AI);
  - Bluesky mentions;
  - alphaXiv, off by default and labelled unofficial.
- **Size.** Up to N talked-about (default 5) and M in-field (default 8). A minimum relevance for in-field papers.
- **Pause, and email.** Pause stops the nightly run. An email digest, off by default, reuses the Resend setup from the job
  search.
- **OpenAlex key.** An optional `OPENALEX_API_KEY` in Integrations, with the note that without it the shared budget may
  run out on Vercel.

### Nightly run

A step in the existing daily cron (03:00 UTC), started as its own workflow like the job search.

1. **Collect new papers.** Fetch the day's new papers from each enabled "new today" source. Drop papers already shown in
   an earlier digest.
2. **Rank in-field papers.**
   - First a cheap filter. Postgres full-text rank or keyword overlap against the field keeps the top ~60 candidates.
     Large categories like `cs.LG` can list several hundred papers a day.
   - Then the AI scores the remaining abstracts in batches against the owner's profile. It returns a 0–100 score and a
     one-line reason, with a link to the owner's work when one exists.
   - The list keeps the top M at or above the minimum.
3. **Collect talked-about papers.**
   - Pull candidates from the enabled traction sources: Hugging Face trending this week; OpenAlex works in the area from
     the last ~60 days sorted by citations, with `counts_by_year` for velocity; alphaXiv hot.
   - Add Bluesky mention counts for the candidates that have arXiv ids or DOIs.
   - The AI drops candidates outside the wider area. It never adds a paper and never changes a number.
   - Rank by the source signals. Keep the top N not shown before. A trending paper may reappear only if its signal grew a
     lot (builder's call on the threshold).
4. **Fetch text ahead.** Queue the full text of the day's digest papers (arXiv, spaced by the crawl delay) so the reading
   room opens on stored text.
5. **Save the digest.** Store the day's digest with each paper's signal line and reason. Record the run like the job
   search does: started, finished, sources that failed and why.
6. **Send the email,** if it is on.

Failures stay local. A source that fails is reported in the run strip, and the rest of the digest still appears. An
AI-provider quota error stops ranking. The digest then shows the unranked candidates under "not ranked tonight", and the
run never falls back to a different paid provider.

### The digest page (admin → Reading → Today)

- **Two sections.** "People are talking about" and "New in your field". Each paper shows title, authors, source and date,
  the signal or reason line, and Open, Save and Dismiss.
- **Earlier days.** Listed by date below today's.
- **Dashboard.** A row with today's count, like the job search.
- **Run strip.** The same pattern as the job search: last run, what failed, Run now.
- **Thin lists.** When a list is short because the sources are thin in this field, one plain sentence says so.

### Built (2026-10-22)

Project 1 shipped as planned in `docs/superpowers/plans/2026-10-22-paper-digest.md`. Decisions made while building it:

- **Defaults:** minimum in-field score 60 and at most 20 AI calls per run (editable up to 100). Papers left when the
  cap is spent are listed as not ranked tonight; the run is not marked stopped.
- **Traction ranking:** each paper's best share of the night's highest number per source (Hugging Face upvotes,
  OpenAlex citations, alphaXiv visits), plus half its share of the highest Bluesky count. A paper with no source number
  above 0 is not talked about.
- **Resurfacing:** a paper shown as talked-about comes back once one of its numbers has at least doubled. Only sources
  present both when it was shown and now are compared, and a paper shown with no stored numbers never comes back. A
  paper that newly trends on a second source is therefore not re-shown.
- **Full text:** the arXiv HTML is stored raw in `reading_texts`, a failure as `404` or its message. Project 2 adds the
  passages table and splits it. The fetches are 15 seconds apart (arXiv's crawl delay).
- **Hugging Face:** the Daily Papers of each of the 7 days up to the run's day (`date=<day>&limit=50`, 7 requests,
  each day by upvotes), and only papers submitted to Daily Papers in those 7 days are kept. The planned
  `sort=trending` without `week=` was replaced: on 2026-10-22 it held papers submitted up to 663 days earlier and
  missed 6 of the week's 10 most upvoted. `week=` lists a week by upvotes too, but its API rejects ISO week 53
  (2026-W53 is this December). The line counts days from the paper's submission to Daily Papers.
- **OpenAlex:** `cited_by_count` within the last 60 days, sorted by citations, filtered to real papers with
  `type:article|preprint|review|conference-paper,is_paratext:false` (checked live); conference papers count because
  CS publishes at conferences. A work of another type, or with no publication date or one before the 60-day window, is
  dropped in code too. Without the filter, subfield 1702's list on 2026-10-22 was led by a dataset with 463 citations
  and a journal-level record.
- **An old paper never leads talked-about:** OpenAlex re-dates an old paper when a new version or DOI appears (two
  conference papers from 2000 were dated 2026-09-11 and led the list with 122 and 115 citations). The record itself
  is checked: `created_date` (returned without a key) must fall inside the 60-day window, and a new-style arXiv id's
  YYMM must not be older than the window's first month. On 2026-10-22, 27 of subfield 1702's top 50 had
  `created_date` 2025-10-10, an OpenAlex backfill date; all are dropped, and 17 remain, led by 16, 14 and 12
  citations. `counts_by_year` is not used: it counts by calendar year, so it shows no velocity inside a 60-day window.
- **bioRxiv and medRxiv categories:** the regex (lowercase words, `_` for spaces) was checked against the live API
  and not widened. Every real category fits; medRxiv's "HIV/AIDS" is `hiv_aids`, and a slash makes the API ignore the
  category and return every paper.
- **bioRxiv versions:** the API lists a paper once per version posted in the window, so only its latest version is
  kept. Each source's own date becomes the paper's date.
- **`any(ids::bigint[])`:** confirmed on the local Postgres, not only pglite.
- **Related paper:** the AI's "close to your…" must name one of the up to 40 publications the prompt lists; any other
  title is dropped.
- **Profile failures:** a profile that can't be read (a broken `research.yml`) is logged, and ranking continues on the
  field and keywords alone that night.
- **Unranked count:** the run's `unranked` counts every unscored pool paper left, though the digest lists at most the
  in-field size of them.
- **Area filter:** no AI call when the talked-about shortlist is empty or no wider area is set. With no wider area the
  talked list needs no AI, so it survives a ranking stop or a spent cap; with one, a stop or a spent cap empties it.
- **Suggest from my profile:** turns on each source it fills (arXiv, bioRxiv, medRxiv, PubMed, OpenAlex) and Hugging
  Face only when the area is ML/AI. Bluesky and alphaXiv are left as they were. Nothing is saved until the owner saves.

## Project 2: reading room

### Getting the text

- **Text sources, in order:**
  1. arXiv HTML. This gives sections and paragraphs with stable ids.
  2. arXiv PDF, with its text extracted in code (a PDF text library such as `unpdf`; builder's pick), split into passages
     with page and paragraph ids. The PDF size cap for this fetch is raised to about 30 MB.
  3. A PDF the owner uploads, handled the same way.
  4. The abstract only.
- **Every source ends as stored passages,** so citations, scroll-to-passage and notebook search work the same for all of
  them. A PDF that yields no text (a scan) falls back to the AI's PDF input, with citations by page only, and the page
  says so.
- **Where it is stored.** Owner-only tables, split into passages, each with an id (section and paragraph number, or page
  and paragraph) for citations. Text is fetched overnight for digest papers, and on first open or Save for any other.
- **bioRxiv and PubMed.** These start with the abstract. Getting PubMed Central open-access full text is the builder's call
  if it is reliable.
- **Treat it as untrusted.** Paper text is untrusted input. It is wrapped with `UNTRUSTED` in every prompt, the model
  gets no tools, and output is rendered as escaped Markdown.
- **Abstract only.** When only the abstract is available, the page says so and grounds everything on the abstract.

### The page

- **Two panes.** The paper on the left: sections, readable typography, figures linked to the source. On the right, tabs:
  Summary, Chat, Notes. On a phone it is one column with the same tabs.
- **Highlights.** The owner selects text in the paper to highlight it, with an optional comment. Highlights are stored
  per passage and feed the paper note.
- **Summary tab.**
  - A short summary and the key findings: what they did, what they found, why it matters.
  - "How it relates to your work": links to the owner's own papers and research areas.
  - Generated on first open as a background run (the page shows progress) and cached. Every claim cites a passage, and clicking a citation scrolls the paper to it and
    highlights it.
- **Study aids, made on demand.** A briefing, an FAQ, and a glossary of terms. Each is cached and can be regenerated.
- **Chat.**
  - Questions about the paper. Answers cite passages the same way.
  - Chat knows the owner's profile, so "how does this compare to my MIRAGE paper?" works.
  - History is kept per paper.
  - Any answer can be saved to the vault as a note.
- **Notebooks.** A notebook groups several papers: digest papers, saved papers, or one added by arXiv id or DOI. Summary,
  study aids and chat then work across all of them, and each citation names its paper.
- **Pages.** The Reading group has Today (the digest), Library (saved papers, plus papers added by arXiv id or DOI),
  Notebooks, Vault (Project 3), and Settings. One papers table serves all of them; Save is a state on the paper.
- **AI use cap.** Reading-room AI calls (summaries, study aids, chat turns) count against a daily cap in settings, default
  100. Settings shows today's use. When the cap is reached, chat says so plainly and the rest of the page still works.
- **Grounding method (my call, see below).** Put the whole text of the paper or notebook in the prompt, marked by
  passage id. When a notebook is too large for the model's context, retrieve the most relevant passages with Postgres
  full-text search. No embeddings.

### Built (2026-10-22)

Project 2 shipped as planned in `docs/superpowers/plans/2026-10-22-reading-room.md`. Decisions made while building it:

- **Chat runs in the request,** not as a background run: one AI call (90 s timeout) and a few queries fit the
  functions' 300 s limit with room, need no resume, and a failed turn stores nothing and is just asked again. A turn
  sends the question (up to 2,000 characters), the last 12 turns, the owner's profile and the paper text. An answer
  left with no words once its citations to passages not in the prompt are dropped is not stored: chat answers "The
  answer cited only passages that aren't in the paper, so it was dropped. Ask again." The summary and study aids are
  a workflow, as planned, since they may first wait on arXiv.
- **Passage ids:** arXiv HTML keeps LaTeXML's own element ids (`S2.p3`, `S2.F1`, `abs.1`), so a citation names the
  same paragraph arXiv does; a PDF's are page and paragraph (`p4.2`), a scan's a page (`page3`). The page shows them
  readably ("§2 ¶3", "Figure 1", "Abstract", "p. 4 ¶2", "p. 3"; in a notebook the first author's surname first), with
  the raw id kept as the citation's title.
- **PDF text:** `unpdf` pinned exactly to 1.8.1 (it reads per-page text in Node with no canvas, and bundles and runs
  under the Workflow SDK's esbuild; 1.9.x was under two weeks old). Paragraphs come from line geometry only: a break
  where the gap to the previous line is over 1.5 × the page's median line gap (the usual median, the mean of the two
  middle gaps on an even count), or where the next line is higher (the next column). A heading or a two-column table
  can run into the paragraph next to it. Bare page numbers and control characters are dropped: pdf.js gives an
  equation's unmapped big brackets as control characters, and Postgres refuses a NUL, which in the live check left
  arXiv 2610.28674 stored as a retryable error until it was fixed. A PDF averaging under 50 characters a page is a scan.
- **Fetching:** each run tries each source at most once per paper (HTML, then PDF after a 404 or HTML with no
  paragraphs), so a 503 can't spin a run. A source that answered 404 is not fetched again; any other failure is a
  retryable error, which the nightly run (for a digest paper) and the next open fetch again. A fetch stores only if the text row is
  unchanged since it began, under the paper's row lock, so it never replaces an owner's upload. The site-wide arXiv
  slot is one statement on `reading_settings.arxiv_at`; checked live on the local Postgres, the fetches went out
  15.0 s apart.
- **When text is fetched:** on Save, on adding a paper to a notebook, and on opening a paper or notebook whose text was
  never fetched or has a retryable error, even when a summary already exists (the "tried again on the next open"
  promise). Adding an unknown paper id to a notebook answers 404.
- **Grounding:** the whole text when the papers fit in 300,000 characters of passages (about 75k tokens, inside every
  configured provider's context). Past that, chat searches the question's words (3 or more letters or digits, at most
  30) or-ed in Postgres full-text search, sanitized so any question is a valid query, and takes the abstracts first,
  then the hits by rank; with no hits, and for the summary and study aids, each paper gets an equal share from its
  start. A passage that doesn't fit its share is skipped and the next one tried, so one long first paragraph can't
  empty a paper. The summary step and chat share one grounding helper (the allowed citations, the `mine` list of the
  owner's papers and areas, and scans).
- **Scans:** a scan of 4 MB or less is kept (`reading_texts.pdf`) and sent as the AI's PDF input when it is the only
  paper, including a notebook of that one paper; in a notebook of several, it contributes only its abstract, to the
  summary and to chat alike (one PDF per prompt). Its citations name a page.
- **Uploads:** the owner's PDF replaces only an abstract, a scan, a missing text or a failed fetch, never a fetched
  full text; up to 4 MB (Vercel's 4.5 MB request body, and the AI's PDF input limit), read only up to that size.
  Uploading clears the paper's summary and study aids, written from the old text.
- **PubMed Central** full text is not fetched: bioRxiv, medRxiv, PubMed and DOI-only papers start with the abstract,
  and an upload gives them full text.
- **Runs:** an output that says running for over 15 minutes is treated as stopped, on the page (Try again) and when a
  new run starts; a second start while one runs gets 409. A failed text fetch fails the run with "Couldn't fetch the
  text of "<title>": <error>", naming the paper because notebooks hold several. The workflow itself calls only steps,
  so no database code reaches its bundle. The summary starts the first time the Summary tab is shown (on open, from
  1024px).
- **The daily cap** counts each summary, study-aid, chat or retried-parse call when it is made, per UTC day
  (`reading_ai_use`). The provider key is checked first, so with no key a failure spends nothing ("Today: 0 of 100").
- **The page:** a highlight lies within one paragraph (or one figure caption); a selection across paragraphs is
  refused with a line saying so. A citation to a passage no longer in the text is shown disabled, and a scan's page
  citation as plain text. The paper's text label covers a text never fetched ("Text not fetched yet").
- **Notes tab, for Project 3:** the owner's free note per paper or notebook (`reading_notes`), the highlights with
  their comments (`reading_highlights`), and chat answers saved with Save to notes (`reading_chats.saved_at`). These
  are what the vault will turn into paper and chat notes; nothing creates a note yet.
- **How it was built:** the missing-key check and the `<paper>` defang are Project 1's, shared (`missingAiKey`,
  `defangPaper`); an output row is updated only in the fields given, so recording a run never wipes the last summary;
  tests build PDFs with a support module (`src/lib/reading/test-pdf.ts`), not a test file; the room page came before
  the Library and Notebooks pages and their links.

## Project 3: vault

- **What it holds.** Markdown notes with YAML front matter and `[[wikilinks]]`, the format Obsidian uses.
- **Notes it creates.**
  - Saving a paper, or highlighting or writing a note on it, creates its paper note: title, authors, link, the generated
    summary, key findings, and the owner's highlights. Merely opening a paper creates nothing.
  - Saved chat answers become notes linked to their paper.
  - The owner writes free notes, such as concept notes or ideas.
- **The editor.**
  - A Markdown editor (the existing Tiptap Markdown editor or a plain one) with `[[` autocomplete.
  - Each note lists its backlinks.
  - A graph view shows notes and links.
- **How the vault grows.** When a note or paper is added, the AI suggests links to existing notes and concepts. Each
  suggestion is shown with its reason, and the owner accepts or dismisses it. Nothing links itself silently.
- **Export.** A zip of the vault: one `.md` per note, folders `papers/`, `notes/`, `chats/`. Front matter carries ids,
  source links and dates. It holds no full paper text.

## Project 4: blog from a paper

- **Drafting.** From a paper, a notebook or a note, "Draft a blog post" writes a draft in the owner's voice. It is grounded
  in the paper or papers, the owner's notes and saved chat answers, and it cites and links the papers.
- **Where it goes.** The draft is created unpublished in the posts collection, and the blog editor opens on it. Nothing
  publishes automatically.
- **Roundups.** Several papers can be drafted together as a roundup post, such as "what I read this week".
- **What it reuses.** The existing paper-post prompt is extended rather than duplicated.

## Planning

Each project gets its own implementation plan, written when the one before ships. Project 1's plan comes first. Its
schema already includes the shared papers table (ids, metadata, state, digest membership) that Projects 2–4 build on.

## Constraints the builder must respect

- Owner-only and Postgres-only, gated like the job search. The pages are hidden in other modes and for other admins.
- Own tables, never `documents`. Migrations continue from 008.
- Respect source limits:
  - arXiv: one request per 3 s across the site, and `Crawl-delay: 15` for HTML/PDF fetches. Fetch full text only for
    papers the owner opens or saves, never for every candidate.
  - NCBI: 3 requests per second.
  - OpenAlex: a daily budget.
  - Identify the site with a mailto where the API asks for one.
- Use the AI provider the owner configured, with no silent fallback to another paid provider. Each nightly run has a cap
  on AI calls.
- Reuse the admin's design (DESIGN.md, `AdminSections`, run strip, list patterns) and its fetching guard.
- Paper text, summaries and chats never reach the public site.

## Calls made by Claude (not explicitly decided by the owner)

- Four projects in this order (digest, reading room, vault, blog). Proposed in chat. The owner didn't object, but didn't
  explicitly agree either.
- Field and wider area derived from the profile, with editable settings, and sources chosen to follow the field.
- Traction sources: Hugging Face (ML only), OpenAlex, Bluesky (on by default), alphaXiv (off by default). Altmetric, Reddit and Semantic
  Scholar left out for the reasons in the table.
- Digest sizes 5 and 8. The digest runs in the existing 03:00 UTC daily cron, with no separate schedule.
- Summary and key findings generated when a paper is first opened, not for every digest paper each night (cost).
- Grounding by putting the whole text in context plus Postgres full-text search for big notebooks. No embeddings.
- The vault lives in the database and exports as a zip. No live Obsidian sync.
- No audio overview for now.
- PDF text extracted in code (a new dependency), so PDF papers get real passages like HTML ones.
- Digest papers' text fetched overnight; summaries made on open with progress shown, not prefetched.
- Highlighting is part of the reading room. A paper note appears on Save, highlight or note, never on a mere open.
- Pages: Today, Library, Notebooks, Vault, Settings.
- A daily cap of 100 reading-room AI calls by default, editable.
