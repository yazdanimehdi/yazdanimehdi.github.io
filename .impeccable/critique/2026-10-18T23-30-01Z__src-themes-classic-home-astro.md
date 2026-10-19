---
target: Classic home
total_score: 19
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 3
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro"
target_fingerprint: "sha256:2505f605a3a0d917acf67267a847b038e3b973c8ea54133b40c8e4e9618d9568"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro
timestamp: 2026-10-18T23-30-01Z
slug: src-themes-classic-home-astro
---
# Critique: Classic home (src/themes/classic/Home.astro)
Method: dual-agent (A4 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Home not in nav, no current marker at / |
| 2 | Match with the real world | 2 | Cryptic C/J/P tiles; duplicated year |
| 3 | User control and freedom | 2 | Whole row opens new tab; "#" fallback |
| 4 | Consistency and standards | 2 | 930 vs 1100 containers; PDF/BibTeX fake links; mixed date formats |
| 5 | Error prevention | 2 | href="#" dead links |
| 6 | Recognition rather than recall | 2 | 9 nav items; Contact in "More" at 1440 |
| 7 | Flexibility and efficiency | 3 | ⌘K search, skip link, View all |
| 8 | Aesthetic and minimalist design | 2 | Name twice above fold; grid paper; placeholders; emoji |
| 9 | Error recovery | n/a | No error states on this page |
| 10 | Help and documentation | 1 | No engagement path |
| **Total** | | **19/36** | **Acceptable (53%)** |

## Design specificity
Generic template with an academic coat; SaaS hero pattern. Detector agrees strongly: overlay flagged 10px badge text ×4 (Home.astro:118,144), codex grid background (global.css:693), Roboto 79%, 117-char About line (AboutSection.astro:21). False positive: HeroSection.astro:71 "off-ramp" 2.75rem — DESIGN.md ramp covers the journal theme only.

## Priority issues
- [P1] Hero lacks role/research focus; lab voice on personal site; affiliation hidden on mobile. /impeccable clarify, /impeccable shape
- [P1] Two content widths; left edge jumps 279→194. /impeccable layout
- [P1] Publication row semantics: new-tab whole-row link, "#" fallback, fake PDF/BibTeX, emoji in h3. /impeccable harden
- [P2] Engagement buried; 9-item nav. /impeccable distill
- [P2] Filler decoration: grid hero, placeholder thumbnails, emoji bullets. /impeccable quieter

## Persona red flags
- Jordan: "Apply Now" unclear; lab copy on personal site; Contact hidden.
- Casey: 16px top-bar targets, 10px badges, papers ~1000px down.
- Sam: emoji announced in headings; aria-haspopup without arrow/Escape support; long row accessible names.

## Minor
FeedItem icon wraps; dark About band loses contrast; ⌘K Mac-only; en-US dates; nav overflow math assumes LTR.
