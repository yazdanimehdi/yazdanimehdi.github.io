---
target: Admin dashboard
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue"
target_fingerprint: "sha256:ce4255379963cf8d81e1269538857a0c5c4b52036b8d1fef1ad8e8443058fb7b"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Dashboard.vue
timestamp: 2026-10-18T23-30-01Z
slug: src-admin-dashboard-vue
---
# Critique: Admin dashboard (src/admin/Dashboard.vue + AdminShell.vue)
Method: dual-agent (A2 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Counts, not health; unexplained "—"; jobs only in postgres mode |
| 2 | Match with the real world | 2 | "Imported posts", "Content storage: Git", "Content" group |
| 3 | User control and freedom | 3 | Hide commits instantly, no Undo |
| 4 | Consistency and standards | 2 | Tiles look clickable but aren't; 30–38px buttons |
| 5 | Error prevention | 2 | Unvalidated Medium URL; Save commits unchanged values |
| 6 | Recognition rather than recall | 2 | News/People folded inside "Content ▸" |
| 7 | Flexibility and efficiency | 2 | No shortcuts; title-only search; unbounded list |
| 8 | Aesthetic and minimalist design | 2 | Medium card and storage tile are noise |
| 9 | Error recovery | 1 | Load failure = "Loading…" forever |
| 10 | Help and documentation | 1 | No help or empty-state guidance |
| **Total** | | **19/40** | **Poor** |

## Design specificity
Category-interchangeable CMS admin; cognitive-load checklist fails 7/8. Detector: markup scan and overlay clean; repo-wide scan flags off-token colors in admin.css:176–188, 234, 407 (agrees with the review's minor notes).

## Priority issues
- [P1] Doesn't answer "is my site current, what's next". Fix: ruled Site status list per automated job with timestamp + action; Next up list. /impeccable shape
- [P1] Failed load stays on "Loading…" (Dashboard.vue:92–99,162). Fix: inline error + Retry, role=status. /impeccable harden
- [P1] Mobile: table overflows (402px in 390), 30px Hide/Edit. Fix: stacked rows, 44px actions. /impeccable adapt
- [P2] Medium settings + duplicate unbounded post index on first screen; "Check now" syncs all feeds. /impeccable distill
- [P2] Bordered stat tiles, no tabular-nums — breaks DESIGN.md. Use Definition facts. /impeccable layout, /impeccable typeset

## Persona red flags
- Tomás (lab contributor): "New post" vs News confusion; no role scoping; one-click commit on Hide.
- Sam: no skip link (12 stops); unlabelled repeated Hide/Edit; disappearing error toast.
- Alex: no shortcuts, filters, sorting; Content group re-collapses.

## Minor
Physical CSS properties in admin.css (RTL); mixed date formats; inline max-width style; toasts not dismissible.
