---
target: Classic home
total_score: 21
max_score: 32
na_heuristics: 5,9
p0_count: 0
p1_count: 2
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro"
target_fingerprint: "sha256:f9a612b428480e1d24ec00c7de33309f2a831fc8a66d2f24a7d322a9d3c0e471"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/classic/Home.astro
timestamp: 2026-10-19T01-00-28Z
slug: src-themes-classic-home-astro
---
# Critique round 2: Classic home (src/themes/classic/Home.astro)
Method: dual-agent (A4 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Mobile drawer has no current state |
| 2 | Match with the real world | 2 | No authors; type chip outweighs venue; year-only dates |
| 3 | User control and freedom | 3 | Drawer doesn't return focus |
| 4 | Consistency and standards | 2 | h2 at 30/20/24px; drawer 9 links vs header 6; drawer English |
| 5 | Error prevention | n/a | No inputs or destructive actions |
| 6 | Recognition rather than recall | 3 | News/Blog collapse into More at 768–900 |
| 7 | Flexibility and efficiency | 3 | ⌘K, skip link, View all |
| 8 | Aesthetic and minimalist design | 2 | Affiliation ×3; grid fills half-empty hero |
| 9 | Error recovery | n/a | No error states |
| 10 | Help and documentation | 3 | Closing engagement block |
| **Total** | | **21/32** | **Acceptable (66%)** |

## Detector
CLI clean. Overlay: overused-font Roboto (false positive, DESIGN.md Classic section names it); codex-grid-background on hero-pattern--grid (global.css:693–704) — real, agrees with A4.

## Priority issues
- [P1] Publications preview lacks authors; accent titles; venue demoted (Home.astro:134–196). /impeccable typeset
- [P1] About band inverts hierarchy; three h2 sizes (AboutSection.astro:18–23, SectionHeading.astro:15). /impeccable layout
- [P2] Mobile chrome 97px sticky; 32px icon buttons 4px apart; drawer focus leak, no aria-expanded/current, English labels (MobileNav.vue). /impeccable harden
- [P2] Pattern hero crude: hard full-bleed grid; classic section silent on backdrops. /impeccable quieter
- [P2] News grid breaks chronology (Home.astro:103). /impeccable layout

## Persona red flags
- Jordan: TopBar repeats role line; generic About; no authors; ambiguous "2024".
- Casey: 97px sticky chrome; cramped icon buttons; 35px news rows; centred vs start-aligned footer.
- Sam: drawer focus leak and no focus return; no aria-expanded; English drawer labels; whole-card link names.

## Minor
Empty Publications/Blog headings render; long brand overflows at 390; DESIGN.md classic token names absent from code; fonts.sizes inert; inset-inline-start-0 not a Tailwind class; Search 34px; no Arabic-script font.
