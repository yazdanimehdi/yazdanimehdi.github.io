---
target: Site editor
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue"
target_fingerprint: "sha256:3b20158f378b47ff21aed64dc158ba789242424ac204c91cd53dc0e39213f344"
target_path: /Users/mehdiyazdani/dev/VsCodeProjects/personal_website_generic/src/admin/Editor.vue
timestamp: 2026-10-18T23-30-01Z
slug: src-admin-editor-vue
---
# Critique: Site editor (src/admin/Editor.vue)
Method: dual-agent (A1 design review, B detector + Playwright overlay)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | No elapsed time; silent preview reload; blank while status loads |
| 2 | Match with the real world | 2 | "session", "deployed branch", "exit code 1", raw provider id, GITHUB_TOKEN |
| 3 | User control and freedom | 2 | No Stop; no in-app undo of publish; one refused file forces a full discard |
| 4 | Consistency and standards | 3 | Two banner styles; session vs publish controls split |
| 5 | Error prevention | 3 | Good allowlist and confirms; destructive dialogs focus the destructive button |
| 6 | Recognition rather than recall | 2 | Preview, diff and Publish never visible together |
| 7 | Flexibility and efficiency | 1 | No Cmd+Enter, Stop, re-run, log follow |
| 8 | Aesthetic and minimalist design | 3 | ~1800px stack, nested iframe box |
| 9 | Error recovery | 2 | Raw OIDC text, no links, no Retry on load failure |
| 10 | Help and documentation | 1 | One 13px paragraph; cost and server-code warning README-only |
| **Total** | | **22/40** | **Acceptable** |

## Design specificity
Stock agent-runner layout; authored copy (scope rule, refused-file rule, "about a minute"). Detector: CLI clean; overlay flagged line-length on the intro paragraph (Editor.vue:153), agreeing with the review.

## Priority issues
- [P1] Publish from memory: Publish ~1500px down under a 70vh iframe, collapsed uncoloured diff, confirm doesn't list files or warn that .astro runs server code. Fix: review step + sticky Discard/Publish bar. /impeccable layout, /impeccable clarify
- [P1] Destructive dialogs auto-focus the destructive button (dialog.ts:26, Editor.vue:292). Fix: initial focus on Cancel, aria-describedby. /impeccable harden
- [P1] Unavailable/blocked states dead-end (GITHUB_TOKEN text, raw OIDC error, unlinked "AI screen", no Retry on load fail). Fix: reason → plain language + one action; disabled Start with reason. /impeccable onboard
- [P2] No control during a run: no Stop, elapsed time, log follow, Cmd+Enter. /impeccable harden
- [P2] Weak end: 8s toast "View commit", raw timestamp. Fix: persistent "Published" + "View live site". /impeccable clarify

## Persona red flags
- Priya (PI, non-developer): End session vs Start over ambiguity; "Git history is the undo"; cost undisclosed; red GITHUB_TOKEN banner on entry.
- Sam: failed run announced as "Ready."; errors only in 8s toasts; Desktop/Phone toggle unlabelled group.
- Alex: no Cmd+Enter, no Stop/re-run, diff truncated without "show all".

## Minor
Intro paragraph 13px muted at ~1100px measure; commit placeholder hides real default; 30px small buttons; non-tabular "Last published" time.
