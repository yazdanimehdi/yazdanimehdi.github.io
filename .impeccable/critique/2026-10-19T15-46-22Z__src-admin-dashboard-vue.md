---
target: critique (admin dashboard)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue"
target_fingerprint: "sha256:0ee3f4056a049723741452b50d1a12949bde85b534f8371a0eb26af37d504587"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue
timestamp: 2026-10-19T15-46-22Z
slug: src-admin-dashboard-vue
closed: true
---
Method: dual-agent. Dashboard was reviewed from source plus live dashboard JSON; the Chrome extension was disconnected.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Git-mode GitHub runs never poll; the row falls back to "No PDF yet" |
| 2 | Match with the real world | 3 | "Pending" for never-run or unknown; "2 not run yet" has no noun |
| 3 | User control and freedom | 3 | Check now/Sync commit with no preview or undo |
| 4 | Consistency and standards | 3 | Duplicate creation actions; DESIGN.md row names drifted |
| 5 | Error prevention | 2 | PDF run can be sent twice; Check now's side effects unstated |
| 6 | Recognition rather than recall | 3 | Verdict doesn't name the rows |
| 7 | Flexibility and efficiency | 2 | No shortcuts, retry-all, or run-everything in git mode |
| 8 | Aesthetic and minimalist design | 3 | Marker and state repeat; relative and absolute time both shown |
| 9 | Error recovery | 3 | Excellent fix mapping; raw strings leak into toasts (Dashboard.vue:72,122) |
| 10 | Help and documentation | 2 | No path to README help; TOKEN_HELP is a sentence, not a link |
| **Total** | | **27/40** | **Acceptable** |

Design specificity: authored. Rows are ScholarOS's own automation with mode-aware fixes; the composition is neutral by design. Authored for the owner as operator; contributors get little. Detector: target clean.

Priority issues:
- [P1] GitHub runs from git mode are fire-and-forget (Dashboard.vue:88-94, 123-125). Hold a "Starting on GitHub…" state and poll; reuse the editor's deploy polling. /impeccable harden
- [P1] "Pending"/unknown mixes three situations (status.ts:166,186,312; dashboard.ts:39); verdict lacks nouns and links wholesale to News. Add a "can't see runs" state, a "Not run yet" marker, and named rows. /impeccable clarify
- [P2] Row focus target omits the row name (Dashboard.vue:200). Use aria-labelledby, or move the id to the li. /impeccable audit
- [P2] Check now / Sync all feeds commit to the live site without saying so; the toast vanishes after 8s with no link (Dashboard.vue:82-86). /impeccable clarify
- [P3] Contributors land on infrastructure first; there are no roles. Lead with Next up when nothing is broken. /impeccable distill

Persona red flags: Alex has no shortcuts, no retry-all, and manual reloads; Sam gets a focus target without the label and "View commit" toasts that auto-dismiss in 8s; the lab contributor sees unfixable rows, mode jargon, localStorage-only news drafts, and a Check now that publishes.

Minor: DESIGN row-name drift; marker/state duplication; People always ok in git mode; nudge on sample content at first sign-in; raw error in toasts.

Questions: reorder around brokenness? An honest "I can't tell" row? Should publishing actions live on a status page?
