---
target: critique (classic home)
total_score: 26
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 1
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro"
target_fingerprint: "sha256:b172d4697c1e68d8413cdc3ae278a9b8bc36c142ba3bcf4252c1726478245280"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro
timestamp: 2026-10-19T15-46-22Z
slug: src-themes-classic-home-astro
closed: true
---
Method: dual-agent. Classic home was reviewed from source and server HTML; the Chrome extension was disconnected.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Mode toggle state shown by icon only |
| 2 | Match with the real world | 3 | Home "BibTeX" navigates away instead of copying |
| 3 | User control and freedom | 3 | Native dialogs with Escape |
| 4 | Consistency and standards | 3 | News and Blog use different list patterns side by side |
| 5 | Error prevention | 3 | Little can go wrong |
| 6 | Recognition rather than recall | 2 | Scholar/ORCID/GitHub only as unlabelled footer icons; research descriptions hidden or truncated |
| 7 | Flexibility and efficiency | 3 | Cmd/Ctrl+K search, not advertised |
| 8 | Aesthetic and minimalist design | 3 | Contact repeated 4 times |
| 9 | Error recovery | 3 | Search empty state is helpful |
| 10 | Help and documentation | n/a | public page |
| **Total** | | **26/36** | **Good (72%)** |

Design specificity: academic in structure (owner in bold, venue, PDF/Code/BibTeX, featured star), generic on the surface (Roboto plus a grid hero, no default portrait). Detector: target clean; the browser "overused-font: roboto" hit is a false positive (pinned classic default).

Priority issues:
- [P1] Scholarly identity buried: Scholar/ORCID/GitHub only as footer icons. Add a text row of profiles under the hero (HeroSection.astro:114-121). /impeccable clarify
- [P2] Research descriptions truncated or hidden (Home.astro:206). Use line-clamp-2 and stacked rows below sm. /impeccable adapt
- [P2] About uses lab voice on a personal site (AboutSection.astro:12, site.yml:122). /impeccable clarify
- [P2] Home BibTeX link navigates away instead of copying (Home.astro:179-183). /impeccable harden
- [P3] Generic grid hero with no portrait by default (site.yml:64, 79-81). /impeccable distill

Persona red flags: PhD student finds the student path only in the last block, with no hero signal and we/I confusion; Casey (mobile) loses research descriptions, and inline link hit areas overlap; Jordan sees an icon-only toggle, icon-only socials, and "BibTeX" jargon.

Minor: 3 of 4 papers featured; year-only news date misaligns; 12px excerpts; site.yml fonts.sizes.base has no effect on home; FeedItem source-first vs tag-last.

Questions: portrait plus profiles vs grid in the first 400px? Does About earn its place? Why is the student path last?
