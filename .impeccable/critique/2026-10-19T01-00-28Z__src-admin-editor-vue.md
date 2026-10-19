---
target: Site editor
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue"
target_fingerprint: "sha256:dad900f5bc5a24ff607d4d883d0714d253b7ac30604ce00df4e02d3111f4627b"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue
timestamp: 2026-10-19T01-00-28Z
slug: src-admin-editor-vue
---
# Critique round 2: Site editor (src/admin/Editor.vue)
Method: dual-agent (A1 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | No stale-preview hint while running; no deploy-finished confirmation |
| 2 | Match with the real world | 2 | workspace, sandbox, Commit message, binary, .astro server-code warning |
| 3 | User control and freedom | 3 | Publish undo = re-prompt; failed run clears the prompt |
| 4 | Consistency and standards | 3 | Two filled primaries in review; Pause/Start vs README wording |
| 5 | Error prevention | 3 | Safety relies on a non-developer reading a diff |
| 6 | Recognition rather than recall | 2 | File list ~1000px below preview; rows not linked to hunks |
| 7 | Flexibility and efficiency | 2 | No edit-and-rerun, history, per-file diff jump |
| 8 | Aesthetic and minimalist design | 2 | Intro, pause help, cost repeat in every state |
| 9 | Error recovery | 3 | Failed run → raw log, no Retry |
| 10 | Help and documentation | 3 | Inline help, copyable steps |
| **Total** | | **26/40** | **Acceptable** |

## Detector
CLI clean. Overlay: line-length on p.adm-editor-intro (~88 chars; admin.css:861 65ch in Plex Sans). Agrees with A1's repeated-copy finding.

## Priority issues
- [P1] Review buried under composer + iframe; Run outranks review (Editor.vue:305–482). /impeccable layout
- [P1] Focus lost to body after Run (Editor.vue:148–154,315); Tab walks the iframe before the review bar (Editor.vue:384–391,484). /impeccable harden
- [P1] Publish asks a non-developer to read code: .astro note (455,535), "Commit message" (541), undo = re-prompt (92–93,410). Plain "what changed" summary, one-click Undo this publish. /impeccable clarify
- [P2] Failed run dead end: prompt cleared (150), status points at raw log (77). Try again / Edit request. /impeccable harden
- [P2] Repeated copy in every state; disabled header Start far from notice. /impeccable distill

## Persona red flags
- Alex: no edit-and-rerun or history; undivided diff pre; Publish bar only reachable after iframe.
- Sam: focus to body after Run; iframe tab trap; unreachable aria-describedby on disabled Start.
- Priya: "read the diff" banner, Commit message field, re-prompt undo, failed state points to a log, no live-site confirmation.

## Minor
⌘ Enter hint on phones; 30px width toggles; long eye-travel on file rows; sticky bar ~120px on phones; Published status branch depends on runs being cleared.
