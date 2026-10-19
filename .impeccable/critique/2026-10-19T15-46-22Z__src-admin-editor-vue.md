---
target: critique (site editor)
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue"
target_fingerprint: "sha256:825dc848a8fc424399082019317ee86f089b6daa43ff5af1570b8ae7d3369fc4"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue
timestamp: 2026-10-19T15-46-22Z
slug: src-admin-editor-vue
closed: true
---
Method: dual-agent. Site editor was reviewed from source plus a live session API; the live page is in the unconfigured state (no GITHUB_TOKEN). The Chrome extension was disconnected.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | No run duration estimate; no marker during the post-publish wait |
| 2 | Match with the real world | 2 | Session/Run/Agent log/Diff/src paths/billing leak to contributors |
| 3 | User control and freedom | 3 | Undo only for refused files; dropping one request means discarding all |
| 4 | Consistency and standards | 3 | "Undo" means three things; Session details-as-button is a one-off |
| 5 | Error prevention | 3 | Publish enabled after failed/stopped runs |
| 6 | Recognition rather than recall | 3 | Setup steps go to the clipboard; preview always opens at the site root |
| 7 | Flexibility and efficiency | 2 | No per-request take/drop; no jump to changed pages |
| 8 | Aesthetic and minimalist design | 3 | Review rail stacks too much; preview scaled small |
| 9 | Error recovery | 3 | explain() layer is good; failed run quotes a raw log line |
| 10 | Help and documentation | 3 | No contextual help at the review decision |
| **Total** | | **28/40** | **Good** |

Design specificity: authored (request → work → review → publish; calibrated confirm; deploy polling; undo). Falls back to developer habits in review (files, raw diff, agent log). Detector: target clean.

Priority issues:
- [P1] Publish enabled after a failed or stopped run (Editor.vue:689; confirm at 141-149 silent). Warn in the bar and the confirm; make Try again/Discard primary. /impeccable harden
- [P1] Preview too small: the review grid sits inside the .adm-main 1080px cap (admin.css:167); the 1280 page is scaled ~0.49 at 1440. Lift the cap in review, narrow the rail, floor the scale ~0.6 (Editor.vue:107). /impeccable adapt
- [P2] Review speaks in files, not pages; the iframe always opens at the root (Editor.vue:724). Map files to routes with "Changed on:" links. /impeccable clarify
- [P2] Confirm's undo promise depends on mode and can be wrong (Editor.vue:142-148). Work out undoability before publishing. /impeccable clarify
- [P2] Unconfigured state hides its steps in the clipboard (Editor.vue:470) and shows billing copy; render an <ol>, hide billing, and add a non-owner line. /impeccable onboard

Persona red flags: Jordan has to press Start before any request box; meets "Session", an open agent log, and raw failure lines. Sam gets identical "Undo this file" names; the Publish confirm autofocuses Publish (Editor.vue:813), so Enter twice publishes; the Session menu doesn't close on blur. The lab contributor has no role check (accounts have no roles), so she can publish code, must judge .astro risk herself, and sees repo paths.

Minor: no marker during the post-publish wait; "Run" vs "Make this change"; GitHub-literate copy; !important margins; vague "that provider"; the 1200px breakpoint ignores the 232px sidebar.

Questions: owner-only publishing / send-for-review? Page-organised review? Independent evidence (build check, before/after captures) rather than the agent's self-report?
