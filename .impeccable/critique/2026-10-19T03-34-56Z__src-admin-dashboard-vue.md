---
target: Admin dashboard
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue"
target_fingerprint: "sha256:f6ec67d1bf866d97ad5be6f90dd4d3e3a82867c6019858df0c2ff4471767ec48"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue
timestamp: 2026-10-19T03-34-56Z
slug: src-admin-dashboard-vue
---
# Critique round 3: Admin dashboard (src/admin/Dashboard.vue + AdminShell.vue)
Method: dual-agent (A2 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | "1 scheduled · 7 hours ago" shows job time |
| 2 | Match with the real world | 3 | Feeds, Run daily jobs, Backup copy |
| 3 | User control and freedom | 2 | One action disables all; no cancel |
| 4 | Consistency and standards | 3 | Run daily jobs = Backup Retry; 880 vs 1080 width |
| 5 | Error prevention | 2 | Retry on rate-limit; Run daily jobs unexplained |
| 6 | Recognition rather than recall | 3 | |
| 7 | Flexibility and efficiency | 1 | No retry-all, shortcuts, role tailoring |
| 8 | Aesthetic and minimalist design | 3 | Duplicate timestamps |
| 9 | Error recovery | 3 | Plain translations; key errors not linked |
| 10 | Help and documentation | 2 | No help links |
| **Total** | | **25/40** | **Acceptable** |

## Detector
CLI and overlay clean.

## Priority issues
- [P1] Emphasis inverted under attention: primary "New blog post" (Dashboard.vue:128); verdict names nothing. /impeccable layout
- [P1] Stale news uses attention red (status.ts:249); sample content triggers on first sign-in. Add a nudge tone. /impeccable clarify
- [P1] Focus lost after in-place action: disabled busy buttons (Dashboard.vue:151,204) + re-sort. /impeccable harden
- [P2] Recovery actions contradict diagnosis: Retry on key errors and 429 (status.ts:77,103-111,274). /impeccable clarify
- [P2] Disclosure markers vanish ≤860px (admin.css:842-849). /impeccable adapt

## Persona red flags
- Alex: Run daily jobs unexplained; no retry-all; serial actions; duplicate timestamps.
- Sam: focus loss; run-on row strings; verdict unlinked; repeated "Technical detail".
- Tomás: owner-only red rows; no "edit my profile"; Next up without author; Slug before Title in news form.

## Minor
Row labels centred vs multi-line main; healthy rows keep routine actions; Next up empty state ignores news; loading jump; small Retry in error banner.
