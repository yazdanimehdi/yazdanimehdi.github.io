---
target: Journal home
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro"
target_fingerprint: "sha256:c0af902b73ec0e884432b052eeb3a0b00aae88e693b59aa20a113fb694264003"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro
timestamp: 2026-10-18T23-30-01Z
slug: src-themes-editorial-home-astro
---
# Critique: Journal home (src/themes/editorial/Home.astro)
Method: dual-agent (A3 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Toggle first click no-op; "system" label wrong; no current nav item on home |
| 2 | Match with the real world | 3 | Strong journal conventions; "Cite" is a jump, not a citation |
| 3 | User control and freedom | 3 | Toggle dead step |
| 4 | Consistency and standards | 2 | h2 at 12px and 36px; News lacks "All news"; 40px nav links |
| 5 | Error prevention | 2 | Hard-coded CTAs show with 0 papers / in lab mode |
| 6 | Recognition rather than recall | 3 | Mobile nav hides Contact/Positions |
| 7 | Flexibility and efficiency | 2 | Cite lands with BibTeX closed; duplicate Paper link |
| 8 | Aesthetic and minimalist design | 3 | Two taglines; tile repeats venue; email ×3 |
| 9 | Error recovery | 3 | Little error surface |
| 10 | Help and documentation | 2 | No engagement guidance for students |
| **Total** | | **25/40** | **Acceptable** |

## Design specificity
Authored to the fold (serif name, Fig. 1 plate, italic venues, bold owner); below the fold reverts to feature-trio and blog-template split. Detector: markup scan and overlay clean; repo-wide scan flagged raw colors in editorial.css:354,359,1586,1589. Detector missed every structural issue.

## Priority issues
- [P1] Publications buried under News and Blog (lib/editorial.ts:212–215); first paper at 1963px desktop / 3229px mobile. /impeccable layout
- [P1] Mode toggle first click no-op under defaultTheme light (ModeToggle.astro:28–47). /impeccable harden
- [P2] Hard-coded CTAs and <title> ("Research Lab") wrong for lab mode / zero publications (Home.astro:58,74–79). /impeccable harden
- [P2] Cite dead-ends (no hash → open details / :target); redundant Paper link. /impeccable clarify
- [P2] RTL/i18n: hard-coded English, en-US dates, letter-spaced uppercase, synthetic italic for Arabic, LTR underline origin. /impeccable adapt

## Persona red flags
- Dr. Okafor (committee): tab title "Research Lab"; papers after blog; tile restates venue.
- Casey: papers 3.8 screens down; 22px social links; nav overflow hides Contact.
- Riley: long name → 3-row mobile header; zero-pub CTA; 5 vs 3 news/blog imbalance.
- Jordan: two thesis lines; meaningless i/ii/iii numerals; no CV in nav.

## Minor
News items not links; unnamed hero/research/papers sections; dark contact band too close to page tone; affiliations spread like a logo bar.
