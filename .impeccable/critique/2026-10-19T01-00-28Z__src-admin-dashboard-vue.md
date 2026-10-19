---
target: Admin dashboard
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue"
target_fingerprint: "sha256:2fa03a29f39401e6510ef07e111d698baff16c33035acf65f84ccab4e3e6b28a"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue
timestamp: 2026-10-19T01-00-28Z
slug: src-admin-dashboard-vue
---
# Critique round 2: Admin dashboard (src/admin/Dashboard.vue + AdminShell.vue)
Method: dual-agent (A2 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | No verdict when any row is unknown (status.ts:184) |
| 2 | Match with the real world | 3 | Committed, Backup to git, HTTP 429; "AI" hides Scholar sync |
| 3 | User control and freedom | 3 | Nothing destructive |
| 4 | Consistency and standards | 2 | Same-style buttons run vs navigate; Add news vs New news item |
| 5 | Error prevention | 3 | Busy lock covers actions |
| 6 | Recognition rather than recall | 2 | 15 flat nav links; empty state names instead of links a button |
| 7 | Flexibility and efficiency | 1 | No shortcuts, recents, sorting |
| 8 | Aesthetic and minimalist design | 3 | No max-width; label to button ~1100px at 1440 |
| 9 | Error recovery | 2 | Raw failure detail; View run ↗ to GitHub |
| 10 | Help and documentation | 1 | No first-run guidance |
| **Total** | | **23/40** | **Acceptable** |

## Detector
CLI and overlay clean.

## Priority issues
- [P1] No verdict when most needed; summary is 14px plain text; attention rows not sorted first. /impeccable clarify
- [P1] Watches jobs, not content currency: no News/People staleness rows; Next up omits news drafts (status.ts:195). /impeccable shape
- [P1] Imperative labels that only navigate: Check now, Set up, Generate/Regenerate PDF, Add news (status.ts:64–91, Dashboard.vue:68). /impeccable clarify
- [P2] Developer recovery path: raw HTTP 429, View run first, Committed/Backup to git. /impeccable harden
- [P2] Unbounded main width; 15-item nav; opaque "AI". /impeccable layout

## Persona red flags
- Alex: no shortcuts/palette/recents; navigate-then-click actions; absolute time only on hover.
- Sam: title-only absolute time; unknown vs off indistinguishable; mobile Menu lacks Escape/focus move; no aria-busy.
- Tomás: Add news lands on a list; profile not reachable; owner-only status above his tasks; news drafts absent from Next up.

## Minor
Same chip style for Scheduled and Draft; "No feeds set up" vs 3 imported posts; raw ISO dates wrap on News list; author vs site title in sidebar; mobile row buttons double page length.
