---
target: critique (journal home)
total_score: 27
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 0
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro"
target_fingerprint: "sha256:38374b470e2f594d61b970aa2fa553f372b34460fe440f4685bf989b0493fe92"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro
timestamp: 2026-10-19T15-46-22Z
slug: src-themes-editorial-home-astro
closed: true
---
Method: dual-agent. Journal home was inspected via headless Playwright (1440/390, light and dark); the Chrome extension was disconnected.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Home has no current-location cue; Cite copy says "Copied"/"Copy failed" |
| 2 | Match with the real world | 3 | Desktop venue tiles show only the acronym; the full venue is screen-reader only |
| 3 | User control and freedom | 3 | Nothing traps |
| 4 | Consistency and standards | 3 | Title and "Paper" link go to the same URL; two heading systems |
| 5 | Error prevention | 3 | Little to get wrong |
| 6 | Recognition rather than recall | 3 | Icon-only mode toggle; People/Positions only in footer |
| 7 | Flexibility and efficiency | 3 | Skip link, one-click BibTeX copy |
| 8 | Aesthetic and minimalist design | 3 | Thesis stated three times |
| 9 | Error recovery | 3 | Copy failure has no select-text fallback |
| 10 | Help and documentation | n/a | public persuasion/reading page |
| **Total** | | **27/36** | **Good (75%)** |

Design specificity: authored (62px serif name, Fig. 1 plate that inverts in dark, venue tiles, roman-numeral research, inline Cite). Weakens below the papers (generic News/Blog split) and on mobile (plate hidden). Detector: target clean; 4 editorial.css #000 mask values are false positives.

Priority issues:
- [P2] Students and credentials are at the bottom: Scholar/ORCID only in the contact band; Positions only in footer; student link commented out in site.yml:46-48. Conflicts with a pinned DESIGN rule; needs an owner decision. /impeccable clarify
- [P2] Desktop venue tiles hide the full venue name (PaperRow.astro:77, editorial.css:1717-1723). Show `.ed-venue` when venueShort differs from venue. /impeccable clarify
- [P2] Mobile hides the Fig. 1 plate (editorial.css:1782-1784). Render a compact plate after the actions. /impeccable adapt
- [P2] Thesis stated three times (tagline, bio, research lede at Home.astro:184-188). Drop the research lede on home when a tagline is set. /impeccable distill
- [P2] Hero email reads as a caption: no resting underline (editorial.css:561-570). /impeccable polish
- [P3] Title and "Paper" link duplicate per paper row (PaperRow.astro:45-56, 82-86). /impeccable distill

Persona red flags: PhD student gets only Publications/CV in the hero, and no "taking students" answer until the end; Casey (mobile) gets no plate, an unstyled email, and "X (Twitter)" orphaned in the footer; Jordan sees bare acronyms, raw BibTeX, and an unexplained "ORAL" chip.

Minor: year-only news date misaligns; dark contact band close to the page colour; ~150px empty gap at the fold; bold institution names look like links; venue-tile year floats at the bottom of the tile.

Questions: papers-before-research vs the surface brief STORY order? Scholar/ORCID in the hero for identity checks? Why is the signature plate cut first on phones?
