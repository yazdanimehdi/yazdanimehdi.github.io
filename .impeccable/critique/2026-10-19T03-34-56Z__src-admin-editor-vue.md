---
target: Site editor
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue"
target_fingerprint: "sha256:a2507064c7037e27c9af5b8796d579a078958111fda18dce3ef1543984873648"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue
timestamp: 2026-10-19T03-34-56Z
slug: src-admin-editor-vue
---
# Critique round 3: Site editor (src/admin/Editor.vue)
Method: dual-agent (A1 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Status line has one weight for Ready/Working/Done |
| 2 | Match with the real world | 3 | Diff, Pause, Start over |
| 3 | User control and freedom | 3 | Pause live during a run, no confirm; undo lost on reload |
| 4 | Consistency and standards | 2 | Modal scrim clipped at 1080; "Desktop" preview ~630px; physical padding |
| 5 | Error prevention | 3 | Undo-this-file can break sibling changes silently |
| 6 | Recognition rather than recall | 3 | Publish confirm drops "What changed" |
| 7 | Flexibility and efficiency | 2 | No Publish accelerator; ask-again collapsed |
| 8 | Aesthetic and minimalist design | 2 | Dense review; .astro note on most changes |
| 9 | Error recovery | 3 | Exemplary setup notices |
| 10 | Help and documentation | 3 | How this works, copy steps |
| **Total** | | **27/40** | **Acceptable** |

## Detector
CLI and overlay clean (round-2 line-length gone).

## Priority issues
- [P1] Publish dialog focus deadlock: dialog.ts:3-9 FOCUSABLE omits summary; getClientRects passes the hidden input in closed <details>. Use checkVisibility() + summary. Admin-wide. /impeccable harden
- [P1] Modal scrim covers only 1080px: .adm-main > * max-inline-size (admin.css:167) hits .adm-modal (Editor.vue:677). Admin-wide. /impeccable polish
- [P2] "Desktop" preview renders ~630px (admin.css:1100); owner approves a non-desktop layout. Scale a 1280px iframe or preview-first review. /impeccable adapt
- [P2] Publish confirm omits summaries (Editor.vue:694); undo relies on in-memory published ref (Editor.vue:25,77). /impeccable clarify
- [P2] Pause enabled during runs (Editor.vue:367); 6 decisions in review; flat status line. /impeccable distill

## Persona red flags
- Alex: no Publish shortcut; collapsed ask-again; two Agent log locations.
- Sam: dialog focus deadlock; scrim gap; no preview-reload announcement.
- Priya: misleading Desktop preview; .astro "someone technical" on most changes; silent sibling breakage; undo gone after reload; no "live site untouched" while running.

## Minor
Published h2 full-width focus outline; phone bar buttons not width-split; physical padding admin.css:1240; unavailable intro mentions absent controls; failureLine picks last match.
