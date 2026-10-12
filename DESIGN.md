---
name: ScholarOS
description: The Quiet Journal. One public theme ("journal", code id editorial) for academic and lab sites, plus the admin that shares its tokens.
colors:
  accent: '#1f3c88'
  accent-hover: '#142a63'
  accent-border: '#c7d0e6'
  selection: '#dce3f5'
  ink: '#15192b'
  body: '#3d4357'
  muted: '#4a5068'
  caption: '#6a7085'
  code: '#2a2f45'
  rule: '#e4e7ee'
  rule-soft: '#eef0f4'
  tint: '#f3f5fa'
  hover: '#f6f8fc'
  paper: '#ffffff'
  band: '#15192b'
  band-text: '#c9cedc'
  band-muted: '#9aa0b4'
  band-rule: '#2c3248'
  danger: '#a12a2a'
  dark-paper: '#0d1117'
  dark-tint: '#161b22'
  dark-hover: '#1c2128'
  dark-ink: '#e6edf3'
  dark-body: '#c9d1d9'
  dark-muted: '#a5aeb8'
  dark-caption: '#8b949e'
  dark-rule: '#21262d'
  dark-rule-strong: '#30363d'
  dark-accent: '#22d3ee'
  dark-accent-hover: '#67e8f9'
typography:
  display:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: 'clamp(40px, 9vw, 62px)'
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: '-1.2px'
  headline:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: 'clamp(36px, 7vw, 52px)'
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: '-0.8px'
  title:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: 'clamp(28px, 5vw, 36px)'
    fontWeight: 500
    lineHeight: 1.2
  stat:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: '36px'
    fontWeight: 400
    lineHeight: 1.1
  initials:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: '32px'
    fontWeight: 400
  numeral:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: '28px'
    fontWeight: 500
  prose-h2:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: '26px'
    fontWeight: 500
    lineHeight: 1.3
  tagline:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: 'clamp(20px, 3.5vw, 24px)'
    fontWeight: 400
    lineHeight: 1.45
  title-sm:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: '19px'
    fontWeight: 500
    lineHeight: 1.35
  prose:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: '19px'
    fontWeight: 400
    lineHeight: 1.75
  bio:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '17px'
    fontWeight: 400
    lineHeight: 1.72
  body:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.6
  ui:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.6
  meta:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: '1.4px'
  note:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 600
    letterSpacing: '1.2px'
  mono:
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace'
    fontSize: '12.5px'
    fontWeight: 400
    lineHeight: 1.6
rounded:
  xs: '3px'
  sm: '4px'
  md: '6px'
  lg: '8px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
  2xl: '48px'
  3xl: '64px'
  section: '80px'
  hero: '96px'
  page-end: '104px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.paper}'
    typography: '{typography.ui}'
    rounded: '{rounded.sm}'
    padding: '0 20px'
    height: '44px'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
    textColor: '{colors.paper}'
  button-outline:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    typography: '{typography.ui}'
    rounded: '{rounded.sm}'
    padding: '0 16px'
    height: '44px'
  button-outline-hover:
    backgroundColor: '{colors.hover}'
  button-light:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.band}'
    typography: '{typography.ui}'
    rounded: '{rounded.sm}'
    padding: '14px 22px'
  button-light-hover:
    backgroundColor: '{colors.selection}'
  mode-toggle:
    textColor: '{colors.body}'
    rounded: '{rounded.sm}'
    size: '44px'
  mode-toggle-hover:
    textColor: '{colors.ink}'
  tab:
    textColor: '{colors.body}'
    typography: '{typography.ui}'
    padding: '10px 0'
    height: '44px'
  tab-active:
    textColor: '{colors.ink}'
  note:
    textColor: '{colors.accent}'
    typography: '{typography.note}'
    rounded: '{rounded.xs}'
    padding: '2px 6px'
  venue-tile:
    backgroundColor: '{colors.tint}'
    textColor: '{colors.accent}'
    rounded: '{rounded.sm}'
    padding: '12px 14px'
    width: '140px'
    height: '92px'
  entry-tile:
    backgroundColor: '{colors.tint}'
    rounded: '{rounded.sm}'
    padding: '12px 14px'
    width: '150px'
    height: '96px'
  figure-frame:
    backgroundColor: '{colors.tint}'
    rounded: '{rounded.md}'
    padding: '24px'
  project-cover:
    backgroundColor: '{colors.tint}'
    padding: '16px'
  input:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '8px 10px'
  admin-button:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '0 14px'
    height: '38px'
  admin-button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.paper}'
    rounded: '{rounded.md}'
    padding: '0 14px'
    height: '38px'
---

# Design System: ScholarOS

## Overview

**Creative North Star: "The Quiet Journal"**

A ScholarOS site reads like a well-edited journal page: white paper, one ink-dark voice for text, one accent color, and hairline rules doing the work that boxes and shadows do elsewhere. Authority comes from typesetting rather than decoration. Names, titles and long reading are set in a serif; interface and metadata in a clean grotesque sans. Tabular numerals keep dates and counts aligned. Structure is announced by headings, meta lines and 1px rules, never by colored panels or cards stacked on cards.

The system is quiet so the research is loud. Density is moderate: generous vertical rhythm between sections (56–104px), tight scannable rows within them (paper lists, news, talks, posts, CV entries, alumni). Motion is limited to small acknowledgements: a link underline that draws in, a row tint on hover, an arrow that nudges 4px, the mode toggle's half-disc turning. All transitions stop under `prefers-reduced-motion`, and the hero video stays on its poster.

The public theme ships as `journal` (code id `editorial`, the default in `config/site.yml`); `classic` remains as a frozen legacy theme. It is one system with many shapes: personal and lab sites, light and dark, LTR and RTL, and any owner-chosen accent or font pairing all read as the same journal. Everything the owner configures (accent per mode, font families, hero backdrop, image shape, home blocks) is a variable inside this language, never an exit from it.

**Key Characteristics:**

- Serif for identity and reading (Source Serif 4), sans for interface (IBM Plex Sans), mono for code, BibTeX and package names (IBM Plex Mono).
- One accent per mode, owner-selectable, used sparingly for links, primary actions, the active nav underline, venue short-names, numerals and the brand mark.
- Rules, not boxes: 1px hairlines separate content, 2px Ink rules mark open-card top edges, aside tops and active tabs.
- Flat surfaces. Depth comes from tint and tone; the only shadow is on floating admin UI.
- Light and dark modes; dark is neutral charcoal with a cyan accent. Ink line-art plates invert with the mode.
- 1080px content measure, 680px reading measure, 32px gutters (16px on phones).

## Colors

The palette is near-monochrome: cool blue-black ink on white, a ladder of four text grays, two rule weights, two pale tints, and one accent. Dark mode mirrors the same roles in neutral charcoal.

### Primary

- **Journal Navy** (accent, a deep slightly-violet navy): links, primary buttons, the active nav underline, the rotated-square brand mark, venue short-names, research and year numerals, BibTeX toggles, note outlines' text, and the 2px focus ring. **Owner-selectable** through `colors.light.primary` (and `colors.dark.primary` for dark) in `config/site.yml`; the override is emitted per mode at build time.
- **Navy Pressed** (accent-hover): hover on primary buttons. With a custom accent it is derived as `color-mix(in oklch, accent, black 25%)` in light mode and `color-mix(in oklch, accent, white 35%)` in dark mode.
- **Navy Wash** (accent-border) and **Selection Wash** (selection): the outline of notes ("Oral", "Spotlight", "Best paper"), the BibTeX copy button's hover border, `::selection`, and the light button's hover on the contact band. Both follow an owner-chosen accent: in light mode `color-mix` with white at 75% and 84%, in dark mode with Dark Paper at 60% and 72%.

### Neutral

- **Ink** (ink): headings, names, titles, primary text, the outline-button stroke, open-card top rules and table header rules.
- **Body Slate** (body): secondary copy, nav links at rest, taglines, bios, the role line under the hero name.
- **Muted Slate** (muted): intro paragraphs, descriptions, excerpts, authors.
- **Caption Gray** (caption): dates, meta lines, captions, section labels, footer text. The lightest gray allowed for text.
- **Code Ink** (code): BibTeX and inline-code text on Hover.
- **Rule** and **Rule Soft**: dividers. Rule for section and list edges, Soft for dense lists (alumni, timeline rows, list-variant paper rows, writing entries).
- **Tint** and **Hover**: figure frames, venue and entry tiles, project cover plates, portrait grounds, the affiliations band (Tint); row hover and code blocks (Hover).
- **Paper**: the page.
- **Contact Band** (band, band-text, band-muted, band-rule): the single inverted region, the "Get in touch" footer on the home page only.
- **Danger**: admin only, destructive button text and field errors.

### Dark mode

Neutral charcoal under the same roles, toggled by `defaultTheme: light | dark | system` and the header's mode toggle.

- **Charcoal** (dark-paper), **Charcoal Tint** (dark-tint), **Charcoal Hover** (dark-hover, also Rule Soft): page, frames and tiles, row hover.
- **Text ladder:** dark-ink, dark-body, dark-muted, and dark-caption, which is the text floor.
- **Dark Rule** and **Dark Rule Strong**: dividers; Rule Strong only on the contact band's inner divider.
- **Signal Cyan** (dark-accent, owner-selectable via `colors.dark.primary`) and **Pale Cyan** (dark-accent-hover). Primary buttons carry Charcoal text on Cyan.
- The contact band becomes Charcoal Tint with a Dark Rule top edge so it stays distinct from the page.
- Classic's "faint" `#484f58` is never used for text; it fails AA.
- The admin stays light-only.

### Named Rules

**The One Voice Rule.** There is exactly one accent hue on any screen. No secondary brand color, no teal-plus-navy pairing in the same mode, and no colored section backgrounds.

**The Caption Floor Rule.** No text is lighter than Caption Gray in light mode or dark-caption in dark mode. An owner-chosen accent must also clear 4.5:1 against Paper in its mode.

**The One Band Rule.** Only one inverted region exists per page: the contact band at the bottom of the home page. Heroes, sections and callouts stay on Paper; the affiliations strip is Tint, not inverted.

## Typography

**Display Font:** Source Serif 4 (with Georgia, serif)
**Body Font:** IBM Plex Sans (with system-ui, sans-serif)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace)

**Character:** A literary serif in a medium weight (500) paired with an engineered sans. The page feels edited and typeset rather than designed. The serif's italic carries taglines, venues and related-paper lines. Families are owner-selectable through `fonts.families` in `config/site.yml`; these are the defaults, loaded with `font-display: optional` so a late swap never shifts the page. A replacement serif must provide an italic and 500/600 weights.

### Hierarchy

- **Display** (500 serif, clamp(40px→62px), 1.04, −1.2px): the owner's or lab's name in the home hero. Once per site.
- **Headline** (500 serif, clamp(36px→52px), 1.1, −0.8px): page titles. The CV title uses clamp(34px→48px); article titles clamp(30px→40px).
- **Title** (500 serif, clamp(28px→36px), 1.2): home section heads and the contact band heading. Research area heads use clamp(26px→32px).
- **Stat** (400 serif, 36px, 1.1): publication counts beside the publications head.
- **Initials** (400 serif, 32px, Caption): the portrait placeholder when a person has no photo.
- **Numeral** (500 serif, 28px, Accent): research area numbers and year headings in publication and timeline lists. Home section-card numerals use 26px.
- **Prose H2** (500 serif, 26px, 1.3): headings inside articles and the positions "apply" head. Prose h3 is 21px.
- **Tagline** (400 italic serif, clamp(20px→24px), 1.45, max 560px): the hero tagline. The research lede is upright serif at clamp(18px→21px).
- **Title Small** (500 serif, 19–21px, 1.35–1.4): paper titles (20px; 19px in lists), post, talk, news and person names (19px), writing entries and project titles (21px), alumni names (18px).
- **Prose** (400 serif, 19px, 1.75, 680px measure): native blog posts and long reading. Person bios use 17px at 1.72, max 580px.
- **Bio** (400 sans, 17px, 1.72, max 580px): the hero bio. The 17px step also carries the hero role line (500), affiliation names (600) and closed-position titles.
- **Body** (400 sans, 16px, 1.6): interface prose, intros (1.65, max 680px), research markdown (1.75).
- **UI** (400–500 sans, 15px): nav links, buttons, tabs, authors, descriptions, excerpts, news text, definition values, "more" links.
- **Meta** (400 sans, 14px, Caption): meta lines under headings, bylines, dates in date columns, portrait roles, footer, table of contents.
- **Caption** (400 sans, 13px, 1.55, Caption): figure captions ("Fig. 1." in 600 Body), post and entry dates, stat labels, tech and tag lines.
- **Label** (600 sans, 12px, 1.4px tracking, uppercase, Caption): section labels that are themselves the heading, and definition-list terms. The accent-colored variant (1.6px tracking) heads the home News and Blog columns, the research Software section and CV sections.
- **Note** (600 sans, 11px, 1.2px tracking, uppercase): notes and the deadline label; the affiliations band label is 11px with 1.6px tracking; writing-entry tags 11px Accent.
- **Mono** (400, 12.5px, 1.6): BibTeX blocks and inline code. Package and repository names use mono at 15–16px.

### Named Rules

**The Serif Speaks, Sans Serves Rule.** Names, page/paper/post titles, venues, quotes and reading text are serif. Navigation, buttons, metadata, labels, form fields and compact card headings are sans. Never set long reading in sans or interface in serif.

**The Tabular Dates Rule.** Every date, year, count and statistic uses `font-variant-numeric: tabular-nums` so columns of numbers align.

**The Heading-Is-The-Label Rule.** Nothing sits above a heading. There are no eyebrow or kicker labels over titles. Uppercase tracked text survives only where it _is_ the heading (`h2` section labels: home News and Blog, research Software, people groups, project status groups, positions and join groups, CV sections, contact and repository groups) or the affiliations band's own label. What a kicker used to carry (role, category, owner, tags) lives in a meta line under the heading: the role line under the hero name, the 14px Caption meta line, bylines.

## Layout

- **Measure:** content max 1080px with 32px inline padding (16px under 640px); articles max 680px plus gutters; intro paragraphs max 680px; bios 580px.
- **Vertical rhythm:** pages pad 64–80px top and 80–104px bottom (48px/64px on phones). The home hero pads 96px/88px (56px/48px on phones). Sections stack with 32px internal gaps and 56–96px between sections.
- **Grids:** fluid `auto-fit` grids with `minmax(min(260–300px, 100%), 1fr)` for section cards, software and projects; `auto-fill` with 200px minimum for people. No fixed column counts. The hero is a wrapping flex row (text 520px basis, figure 420px basis up to 500px) with a 64px gap that stacks at narrow widths.
- **Date columns:** news, talks and positions are rows with a right-aligned tabular date column (112px; 76px in the home news list; 96px for alumni years) beside the content. On phones the date moves above the content and aligns to the start.
- **Breakpoints:** the design breakpoint is 640px. The person profile's portrait-plus-text grid (260px + 680px) stacks at 760px. Everything else is intrinsic: flex-wrap, clamp() and min().
- **Direction:** logical properties (`padding-inline`, `margin-inline`, `inset-inline-*`, `text-align: start/end`) everywhere, so RTL mirrors without overrides. The hero pattern's fade origin, the phone nav's scroll mask and arrows are the only explicit RTL rules.

### Named Rules

**The Shared Edge Rule.** Every row rule sits on the column edge. A row's hover tint may bleed 12–16px past the column (negative inline margin, 6px radius), but its divider does not: it is drawn as a 1px centered gradient at `calc(100% − 2 × bleed)`, or on the unbled list item. Rules from different lists, heads and sections all start and end on the same vertical line.

## Elevation & Depth

Flat. Public pages use no shadows at all. Depth comes from tone: Tint frames, tiles and cover plates sit one step off Paper, Hover tints a row, the Tint affiliations strip sits between two Rules, and the single inverted contact band closes the home page. Layering is expressed with 1px rules and 2px Ink top edges.

The hero backdrop (`hero.type`) is the one atmospheric layer, and it stays behind the paper:

- **pattern** (and **animation**, which the journal draws as the configured pattern): an Ink hairline pattern (grid by default; dots, diagonal, waves, hexagons) at 7% opacity (10% in dark), masked to fade from the figure side toward the text and the fold.
- **image**: a cover image under an 86% Paper wash, with an optional separate dark-mode image.
- **video**: muted, looping, under the same wash; autoplays only when motion is welcome, otherwise the poster stays.
- **none**: paper only.

### Shadow Vocabulary

- **Admin float** (`box-shadow: 0 6px 20px rgb(21 25 43 / 0.12)`): only for floating admin UI that overlaps content.

### Named Rules

**The Paper Rule.** If it isn't floating above other content, it has no shadow. Cards, tiles, buttons, plates and heroes are flat.

## Shapes

Small, almost-square corners. Buttons, tiles, code blocks, rectangular portraits and the mode toggle use 4px. Hover regions, figure frames, software cards and admin fields use 6px. Notes and inline code use 3px. Admin modals use 8px. Nothing is pill-shaped; the only round forms are an owner-chosen circular (50%) or oval (40%) portrait and the mode toggle's disc. Section and project cards are open shapes: a 2px Ink top rule, no side or bottom borders. Rules are 1px except the 2px Ink card tops, article aside tops, and active tab and nav underlines. The brand mark is a 10px Accent square rotated 45°.

Icons are drawn, not typed, when they stand alone: the arrow is a 16px SVG with a 1.5px round-capped, round-joined stroke in `currentColor`, matching the mode toggle's 1.5px circle.

## Components

### Buttons

Rectangular, solid and plain.

- **Shape:** gently squared (4px), 44px minimum height.
- **Primary:** Accent fill, on-accent text (white; Charcoal in dark), 15px/500 sans, 0 20px. Hover deepens to Accent Hover. No transform or shadow.
- **Outline:** 1px Ink stroke, Ink text, 0 16px. Hover fills with Hover.
- **Light (contact band):** Paper fill, Band text, 14px 22px. Hover goes to Selection.
- **Focus:** a 2px Accent outline at 2px offset on every focusable element (Paper-colored inside the contact band).
- **Admin:** 38px tall, 6px radius, 1px Rule border on white, 14px. Primary is Accent-filled; danger is Danger-colored text; small is 30px/13px.

### Links and arrows

- Inline links are Accent with no underline at rest. The underline draws left to right over 0.25s on hover and focus. Links inside prose are underlined at rest (1px, 3px offset).
- **Inline arrows** (→ for onward, ↗ for external, ← for back) are typeset text glyphs inside link text ("All posts →", "Curriculum vitae →"). They nudge 4px in the reading direction on hover and mirror in RTL.
- **Standalone arrow columns** (the trailing arrow of post rows, repository rows, software cards, related-project links) use the drawn Arrow: 16px, 1.5px round stroke, Accent, with the same 4px nudge and RTL mirroring.

### Mode Toggle

A 44px icon button at the end of the nav row: a 1.5px-stroke circle with a filled half. The half turns to show the mode (right half light, left half dark, rotated a quarter for system) over 0.35s with a soft ease-out. It cycles light → dark → system, carries its state in `aria-label` and `title`, Body at rest and Ink on hover. No label pill.

### Tabs

Text-only, 15px Body, with a 2px transparent underline sitting on the filter bar's 1px Rule. Active is Ink, 500, with a 2px Ink underline (`aria-pressed` for filters, `aria-current` for category links). Counts sit in 12px Caption. The checkbox toggle is a 14px Body label with a native Accent checkbox and a 44px hit area.

### Notes (tags)

1px Navy Wash outline, Accent text, Note type, 3px radius, 2px 6px padding: "Oral", "Spotlight", "Best paper". No filled chips and no pills.

### Venue Tile (signature)

The paper's identity block: a 140×92px Tint tile with a Rule border and 4px radius, holding the venue short-name in 20px/600 Accent serif and the year in 12px tabular Caption. A venue without a short name is set at 13px and clamped to three lines. Writing entries use a 150×96px variant carrying an 11px Accent tag and a 13px date.

### Paper Row (signature)

Venue tile, then the title (Title Small serif, Accent on hover), authors with the owner in 600 Ink, a venue line in italic serif, and notes. The row ends with a BibTeX `<details>` whose block is 12.5px mono Code Ink on Hover with a Rule border and a quiet Copy button in its top inline-end corner. Rows bleed their hover tint 16px and keep their Rule on the column edge. The list variant drops the tile and uses Rule Soft.

### Section and Project Cards (open cards)

An open card: a 2px Ink top rule and nothing else. The home section card holds a 26px Accent serif numeral, a 19px/600 sans heading, 15px Muted text and an italic serif Caption line of related papers with an arrow. The project card holds an optional cover, a 21px serif title, notes, a 15px description, 13px tags and 15px/500 links. When a project has a cover, the plate hangs straight from the 2px rule: a 3:2 Tint plate with 16px inset, art contained, no gap above it.

### Ink Plates

Demo and owner line art ships as ink (`#15192b`) hairlines on transparency, set on Tint frames: the hero "Fig. 1" figure (6px frame, 24px inset, 13px caption with a bold "Fig. 1."), research area figures, project covers, post covers and news thumbnails. Line art is detected at build time from the file itself (transparent ground, dark near-monochrome ink) and gets the ink class; in dark mode it inverts (`invert(1) hue-rotate(180deg)` at 88% opacity) so it reads as light ink on Charcoal. Photographs are never inverted. Covers cap at 420px tall.

### Rows and lists

- **Timeline row:** tabular date column, 19px serif title, 15px excerpt, italic serif venue, 14px meta; an optional 120px Tint thumbnail. Rule Soft between rows.
- **Post row:** 19px serif title over a 13px meta line, drawn arrow at the end.
- **Definition facts:** 12px uppercase Caption terms over 15px Ink values, separated by 1px Rules.
- **Result pull:** a 14px line between two hairlines, never boxed or side-tabbed.

### People

A fluid grid of portraits (4:5, or square for circular and oval `imageShape`) on Tint, then a 19px serif name and a 14px Caption role and a two-line 14px Muted focus. The name's link covers the whole card. Without a photo, a 96px initials square replaces the portrait. Alumni are date-column rows. Groups are headed by a Label over a Rule with a tabular count.

### Inputs / Fields (admin)

- **Style:** white field, 1px Rule stroke, 6px radius, 8px 10px padding, 14px sans.
- **Label:** 13px/500 above the field. Help text is 13px Caption.
- **Error:** 13px Danger text below the field.

### Navigation

- A header bar with a 1px Rule bottom. The brand (Accent rotated square plus the name in 19px/600 serif) sits at the start; links (15px sans, Body, 28px gaps) and the mode toggle at the end. No hamburger.
- **Hover:** Body to Ink. **Active:** Ink, 500, 2px Accent underline (`aria-current="page"`).
- **Phones (≤640px):** the brand and the mode toggle share the first line; the links become one sideways-scrolling row that bleeds to the screen edges, hides its scrollbar, fades out over its last 28px (mirrored in RTL), and scrolls the current page into view.

### Contact Band

The one inverted region, on the home page only. A Title serif heading in Paper, Band Text copy, a Light button carrying the email, and a bottom row of copyright and links over a Band Rule divider. Other pages close with a light 1px-ruled footer in 14px Caption.

## Do's and Don'ts

### Do:

- **Do** separate content with 1px Rule hairlines and reserve 2px for open-card tops, aside tops and active underlines.
- **Do** keep every row rule on the column edge while the hover tint bleeds past it.
- **Do** put role, category and tag information in a meta line under the heading.
- **Do** set every date, year and count in tabular numerals.
- **Do** draw standalone arrows with the 16px, 1.5px round-stroke Arrow; keep inline → ↗ ← as typeset text in the link.
- **Do** ship line art as ink on transparency and let the build mark it for dark-mode inversion; keep photos as photos.
- **Do** keep text at Caption or darker in light mode and dark-caption or lighter in dark mode.
- **Do** give every interactive element a 44px minimum target and the 2px Accent focus ring.
- **Do** use logical CSS properties so RTL sites mirror cleanly.
- **Do** stop all transitions under `prefers-reduced-motion`.

### Don't:

- **Don't** put an eyebrow or kicker label above a heading. Uppercase tracked text is only ever the heading itself or the affiliations band label.
- **Don't** use gradients, glows or colored section backgrounds. The hero backdrop stays an Ink hairline pattern or an image under a Paper wash.
- **Don't** use pill-shaped buttons or tags, or radii above 8px (circular or oval portraits and the mode toggle's disc excepted).
- **Don't** put shadows on public-page elements. Shadows are for floating admin UI only.
- **Don't** introduce a second accent hue. Teal/cyan appears only as the dark-mode accent.
- **Don't** use emoji or icon-font glyphs as icons.
- **Don't** set navigation, buttons or form fields in the serif, or long reading text in the sans.
- **Don't** let configurable options (hero type, home blocks, accent, fonts) introduce a layout that exists only in one mode. Personal, lab, light, dark, LTR and RTL share every component.
