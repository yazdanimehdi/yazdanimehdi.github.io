---
target: Classic home
total_score: 26
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 2
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro"
target_fingerprint: "sha256:59f8c03cdefb7e67baaadd6f51e57d27bf261eed85135bcec3a530524bae1eee"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro
timestamp: 2026-10-19T03-34-56Z
slug: src-themes-classic-home-astro
---
# Critique round 3: Classic home (src/themes/classic/Home.astro)
Method: dual-agent (A4 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | |
| 2 | Match with the real world | 3 | Featured ★ has no visible legend |
| 3 | User control and freedom | 3 | Toggle can't return to system; search drops focus |
| 4 | Consistency and standards | 3 | Contact ×3 styles; search off-palette |
| 5 | Error prevention | 3 | |
| 6 | Recognition rather than recall | 3 | Unlabelled footer page row |
| 7 | Flexibility and efficiency | 3 | ⌘K/Ctrl K, skip link |
| 8 | Aesthetic and minimalist design | 3 | Empty hero half without portrait |
| 9 | Error recovery | 2 | Search empty state has no fallback |
| 10 | Help and documentation | n/a | Read-only profile page |
| **Total** | | **26/36** | **Good (72%)** |

## Detector
CLI clean. Overlay: overused-font Roboto — false positive (DESIGN.md Classic section).

## Priority issues
- [P1] Search overlay not an accessible dialog: no role, trap or focus return; outline-none input (SearchDialog.vue:22-50). /impeccable harden
- [P1] Publications third and half width (Home.astro:126-129); adopt homeBlocks order. /impeccable layout
- [P2] Research answered by one tagline; no research case on home. /impeccable clarify
- [P2] Footer line bidi-flips in RTL (Footer.astro:54-58). /impeccable harden
- [P3] Contact repeated and diluted (Home.astro:276-296). /impeccable distill

## Persona red flags
- Jordan: empty hero half; unexplained ★; publications below the fold; unlabelled footer row.
- Casey: publications ~1000px down; 36px news rows; engage email wraps alone.
- Sam: search trap/focus loss; "Featured:" repeated in headings; two identical "View all →"; date-first news link names.

## Minor
News date column indent; faint grid reads as noise; .pub-badge 11.2px on /publications; footer h3 without h2; middot hugging in RTL; lab TopBar truncation.
