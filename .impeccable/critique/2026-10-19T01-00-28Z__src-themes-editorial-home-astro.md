---
target: Journal home
total_score: 28
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 3
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro"
target_fingerprint: "sha256:8181b764b357366bac52d8aeae9b9d7b9b61365454b8dd4bd0ba2010e9dd8145"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro
timestamp: 2026-10-19T01-00-28Z
slug: src-themes-editorial-home-astro
---
# Critique round 2: Journal home (src/themes/editorial/Home.astro)
Method: dual-agent (A3 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | "system" mode only a rotated disc |
| 2 | Match with the real world | 4 | Fluent academic conventions |
| 3 | User control and freedom | 3 | Cite leaves the page |
| 4 | Consistency and standards | 3 | Cite navigates vs expands; h2 36px serif vs 12px caps |
| 5 | Error prevention | 3 | Off-site paper titles lack ↗ |
| 6 | Recognition rather than recall | 3 | CV in no nav (sample nav lab-shaped) |
| 7 | Flexibility and efficiency | 3 | Skip link, Cite deep link |
| 8 | Aesthetic and minimalist design | 3 | Tile repeats venue line; research h2 repeats tagline |
| 9 | Error recovery | 3 | Graceful degradation |
| 10 | Help and documentation | n/a | Persuade-light surface |
| **Total** | | **28/36** | **Good (78%)** |

## Detector
CLI and overlay clean.

## Priority issues
- [P1] Proof 1.5 screens down behind affiliations + research (lib/editorial.ts:230–244, Home.astro:142–176). /impeccable layout
- [P1] Venue tile duplicates meta line; +110px per paper on mobile (PaperRow.astro:31–39,62). /impeccable distill
- [P1] RTL content leaks: no dir=auto on English titles/bios, roman numerals ".iii" (lib/editorial.ts:112), no Arabic-script font fallback, "min read" hard-coded (PostRow.astro:15 etc.). /impeccable harden
- [P2] 22px tap targets: hero links, Cite, Code, footer index; X link 9px wide. /impeccable adapt
- [P2] Research h2 is a slogan, not "Research" (Home.astro:159–161). /impeccable clarify

## Persona red flags
- Jordan: no "Research" heading; titles lack link affordance; icon-only mode toggle; mixed profile/email row.
- Casey: papers ~2.4 screens down; venue tiles; 22px links; nav fade implies more links.
- Riley: RTL punctuation flips, ".i" numerals, English "min read", no Persian font.
- Dr. Okafor: proof below the fold; no metrics; CV absent from header; current vs former affiliations unclear.

## Minor
Lab hero gives Open positions the weakest slot; eyebrow shared across modes; fonts.sizes inert in journal; BibTeX open jumps Cite to its own line; dark mode reads GitHub-charcoal + cyan; dark contact band still close to page.
