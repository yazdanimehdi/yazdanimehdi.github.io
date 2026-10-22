# Admin UX overhaul

The owner finds the admin too crowded and hard to use. This spec reorganises it without changing its visual world:
the journal tokens, IBM Plex Sans, ruled rows, 6px radii and the rules in DESIGN.md's Admin section stay. What changes
is structure: where things live, how much of it is on screen at once, and whether the main action is always in reach.

## What is wrong today (measured 2026-10-22, 1440px wide)

- **Settings is one 7,300px column.** Twelve fieldsets (identity, theme, fonts, ten nav items as stacked
  label/link pairs, socials, hero, admin users, feeds) with one Publish button at the very top and a second
  document (feeds) with its own button at the very bottom.
- **Job search settings is 4,800px** with three separate save buttons (preferences, answers, each key).
- **Keys live on two screens.** Scholar & AI lists AI and SerpApi keys; Job search settings lists Adzuna, USAJobs and
  SerpApi again.
- **"Scholar & AI" mixes three jobs:** keys, the writing/image provider, and the Scholar sync.
- **Inputs stretch to 1,000px** for values like a two-letter country code or a number, which makes every form look
  heavier than it is and puts help text at an unreadable measure.
- **The sidebar is a flat list of 16 links**, two of which (CV, CV styles) are one job.
- **Once you scroll, the page's Publish button is gone.** There is no sign that a form has unsaved changes.
- **The job feed** uses a full-width select for status and a boxed "Last run" card.

## Design

### 1. Sidebar and navigation

Groups, in order of how often they are used:

| Group | Links |
|---|---|
| (top) | Dashboard |
| Content | Blog posts, News, Publications, CV, People, disclosure: Projects, talks, positions |
| Career (owner, Postgres) | Job search, with a count badge of postings ready for approval |
| Site | Pages, Media, Site editor |
| Setup | Settings, Integrations, Users (Postgres) |

- **CV styles leaves the sidebar.** CV and CV styles share a tab row under the page title ("Entries", "Styles"); the
  `cv-styles` URL is kept. The sidebar marks CV current on both.
- **"Scholar & AI" becomes "Integrations"** (URL `ai` kept).
- **Jump to (Cmd/Ctrl+K).** A button at the top of the sidebar ("Jump to…", with the shortcut shown) opens a native
  `<dialog>` with a filter field and a list of every destination plus the create actions (New blog post, New news item,
  New publication). Arrow keys move, Enter goes, Escape closes. Filtering is a case-insensitive substring match.
- The count badge is a 12px tabular number on Tint with a 1px Rule ring (no fill colour), so it reads as a count, not
  an alarm.

### 2. Sticky page header with save state

- `.adm-head` (title + actions) sticks to the top of the viewport on scroll, on Paper with a 1px Rule underneath once it
  is stuck. The page's primary action is therefore always in reach.
- Document-backed screens show "Unsaved changes" (13px Caption, before the actions) when the open document differs from
  what was loaded or last saved. `useDocument` gains a `dirty` flag for this.
- Leaving a page with unsaved changes asks the browser's `beforeunload` confirm. (Drafts are already kept in
  localStorage; this only warns.)

### 3. Sectioned pages

A new `AdminSections` component for long configuration screens: Settings, Integrations, Job search settings.

- **Wide (≥ 1100px):** a 200px section list beside the content, sticky under the header. One section is shown at a time.
- **Narrow:** the same list becomes a sideways-scrolling tab row above the content.
- The selected section is in the URL hash (`#appearance`), so links, reloads and the browser's back button work. An
  unknown or missing hash shows the first section.
- A section whose fields have a save error shows a Danger dot in the list, and saving with errors jumps to the first
  such section.
- It is a `role="tablist"` with `aria-selected`; arrow keys move between tabs.

Section maps:

- **Settings:** Identity · Appearance (theme, colours, fonts) · Header & hero (top bar, hero) · Navigation ·
  Social links · Feeds · Access (admin users). The header action publishes the document that the open section belongs
  to ("Publish settings" or "Publish feeds").
- **Integrations:** Keys (every key on one ruled list: AI providers, SerpApi, Higgsfield, Adzuna, USAJobs, and later
  the project-3 keys) · Writing & images · Google Scholar.
- **Job search settings:** What I want · Sources (sources, watched companies, feeds) · Tailored CV · Application
  answers. Its keys move to Integrations → Keys. One header "Save" saves preferences and answers together.

### 4. Form density

- Form content caps at 640px (`.adm-form`), so fields and help text sit at a reading measure. Number inputs are 10ch,
  colour text fields 12ch.
- **Inline repeaters.** An `objects` field whose sub-fields are all single-line (text, number, select) renders each
  item as one row of inputs under a column header, with the move/remove buttons at the row's end. The navigation menu
  goes from about 1,000px to about 450px. Other repeaters keep the stacked layout.
- Sections replace nested `<fieldset>` boxes; inside a section, sub-groups are an 15px/600 heading over a Rule, not a
  bordered box.

### 5. Job search

- A tab row under the title: **Postings · Ready for approval (n) · Settings**. (Ready for approval is filled by project
  3; until then it lists postings whose status is "ready for approval", which can already be set by hand.)
- The "Last run" box becomes a one-line verdict strip like the dashboard's: "Last run 3 h ago · 34 found · 5 matches"
  with Run now at its end.
- The full-width status `<select>` becomes a compact row: filter tabs for Open, Drafted, Ready for approval and
  Submitted, then a small "Other status" select for the rest (skipped, interview, offer, rejected, no response,
  withdrawn, all).

### 6. Phones

Everything above keeps the existing phone behaviour: the sidebar collapses behind Menu, sections become a scrolling tab
row, inline repeater rows stack, touch targets are 44px.

## Out of scope

Visual identity changes, new colours or fonts, the post editor and the site editor (both already work as focused
tools), and the public site.
