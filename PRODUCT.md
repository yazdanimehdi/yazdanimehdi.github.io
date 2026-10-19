# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: site visitors.** Prospective students, collaborators, hiring and tenure committees, reviewers, and journalists evaluating a researcher or lab. They arrive from a paper, a talk, a search, or a referral, usually to answer one question fast: who is this, what do they work on, what have they published, can I work with them. When design decisions conflict, the visitor's success wins.

**Secondary: site owners.** Individual researchers and PIs who fork the template, configure it in YAML, and keep it current.

**Secondary: lab contributors.** Non-technical lab members who edit posts, announcements, people profiles, and CV entries through the browser admin without Git.

## Product Purpose

ScholarOS is a free, open-source (MIT) academic website system: "a living operating system for academic and research websites." It exists because academic sites fail on maintenance cost: publications drift, CVs fall out of sync with PDFs, news goes stale, labs rotate members. Success is a public site that stays accurate and current by default, with manual work as the exception.

## Positioning

A system, not a theme. Structured data (YAML/Markdown or Postgres) is the single source of truth; automation (Scholar sync, feed import, scheduled releases, CV PDF rendering) keeps it fresh; a browser CMS covers what automation cannot. One codebase serves both an individual researcher and a multi-member lab via a single config flag, and can import an existing al-folio site content-only.

## Operating Context

- Owners fork from GitHub (`yazdanimehdi/ScholarOS`), edit `config/*.yml`, push, and the site deploys.
- Three deployment modes: **static** (GitHub Pages, Sveltia CMS committing to the repo), **git** (Vercel, custom Vue admin committing via GitHub), **postgres** (Vercel + Neon Postgres + Vercel Blob, custom admin with user accounts).
- GitHub Actions run daily/scheduled jobs: deploy, feed sync, Scholar sync, CV render, SEO keyword generation, scheduled-post release, template sync, al-folio migration.
- The owner's own site (yazdanimehdi.com) is one deployment; its design handoff (`HANDOFF.md`, `personal-site-handoff/design/`) informed the editorial theme.

## Capabilities and Constraints

- Stack: Astro 5, Vue 3 islands, Tailwind CSS v4, TypeScript; Tiptap editor with KaTeX; pdfmake for CV PDF.
- Content collections: publications, posts, projects, people, positions, talks, announcements; CV from structured YAML (RenderCV-compatible import).
- Public pages: home, research, publications, CV, blog (native + Medium import), news, people, positions/join, projects, talks, repositories, contact, RSS.
- Admin: dashboard, posts editor, collections, CV editor with PDF generation, media library, pages, settings, user accounts (postgres mode).
- **Binding:** personal and lab modes must both keep working.
- **Binding:** both visual themes, `classic` and `editorial`, must keep working; themes are selected in `config/site.yml` or via `SCHOLAROS_THEME`.
- **Binding:** any BCP 47 language and right-to-left scripts (e.g. Persian, Arabic) must render correctly; light/dark/system color modes are supported.
- Sample content (fictional "Smith Research Lab", placeholder publications and people) ships with the template for forkers to replace.

## Brand Commitments

- Name: **ScholarOS**. Logo at `assets/logo.png`.
- Voice (from README): plain, direct, practical; frames the site as "a living research surface, not a static brochure"; respects users' existing work and data ownership.

## Evidence on Hand

- README feature set, workflows, and migration docs; `CONTRIBUTING.md`.
- Owner's real CV data in `personal-site-handoff/cv.yaml` (reference deployment only, not template content).
- No user testimonials, adoption numbers, or case studies exist; do not invent them.

## Product Principles

1. **Current by default.** Prefer automation and derived views over anything a person must remember to update.
2. **One source of truth.** Every fact lives once in data; pages, PDFs, and feeds are views of it.
3. **Visitor first.** The public site answers "who, what, published, how to engage" faster than any admin convenience is worth.
4. **One system, many shapes.** Personal and lab, classic and editorial, LTR and RTL are the same product, never forks of it.
5. **Static and fast unless interaction earns it.** JavaScript ships only where search, filters, forms, or editing need it.

## Accessibility & Inclusion

- WCAG AA: 4.5:1 text contrast, full keyboard access, semantic HTML.
- Lighthouse 95+ on public pages.
- Correct rendering for RTL scripts and non-English languages.
