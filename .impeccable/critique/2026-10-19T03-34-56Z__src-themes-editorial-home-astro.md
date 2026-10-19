---
target: Journal home
total_score: 26
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 2
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro"
target_fingerprint: "sha256:646b927f2bf0b4272cb305d8e9fa019d6b350199bd3c9dc44aa30fa1ea786b8c"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/themes/editorial/Home.astro
timestamp: 2026-10-19T03-34-56Z
slug: src-themes-editorial-home-astro
---
# Critique round 3: Journal home (src/themes/editorial/Home.astro)
Method: dual-agent (A3 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | |
| 2 | Match with the real world | 3 | "BibTeX →" lands on "Cite" |
| 3 | User control and freedom | 3 | Citing costs a page load |
| 4 | Consistency and standards | 3 | Two h2 systems; sans research titles |
| 5 | Error prevention | 3 | .ed-email lacks overflow-wrap |
| 6 | Recognition rather than recall | 3 | People/Positions footer-only |
| 7 | Flexibility and efficiency | 2 | No inline cite or PDF on home rows |
| 8 | Aesthetic and minimalist design | 3 | 8 hero links; profiles repeated in band |
| 9 | Error recovery | 3 | |
| 10 | Help and documentation | n/a | Persuade-light surface |
| **Total** | | **26/36** | **Good (72%)** |

## Detector
CLI and overlay clean. All three night palettes reviewed; Ink Well judged most coherent, Lamplight reads as a journal at night.

## Priority issues
- [P1] Hero reach cluster overloads first viewport; first paper ~1150px on phones (Home.astro:122-141). /impeccable distill
- [P1] Hero actions/role/author bolding ignore lab mode (Home.astro:43-48,211). /impeccable clarify
- [P2] Cite costs a page load; label mismatch; no Paper link on home (PaperRow.astro:95,110-112). /impeccable clarify
- [P2] RTL: Fig. 1 label flips (Home.astro:157); affiliation dot orphans; serif slot falls to Arabic face's Latin sans (global.css:59). /impeccable harden
- [P2] Research block is a three-up feature grid (Home.astro:183-193). /impeccable layout

## Persona red flags
- Jordan: unexplained ↗; BibTeX navigates away; People/Positions footer-only.
- Casey: wrapped profile row; figure/papers far down; sticky hover after cite.
- Riley: long email overflow; orphan separator; bare "2024" date; 0 pubs promotes CV silently.
- Dr. Okafor: CV not primary; no PDF; unexplained selected order; no metrics.

## Minor
Lamplight contact band barely separates; aria-hidden ↗ gives no external cue; Accent eyebrows look like links; dead zone under figure.
