# Site editor: change the site's code in plain language, preview in a sandbox, publish — design spec

Date: 2026-10-12 · Status: decisions approved in chat; sandbox mechanics proven by a live spike

## Intent

A new admin screen, **Site editor** (`/admin/editor`). An admin types a request ("make the header serif and
move the news section above publications"). A coding agent edits a copy of the site's source in a Vercel Sandbox;
a live dev server in that sandbox gives a preview URL; the admin sees the changed files and the diff, can ask for
more changes, discard them, or **Publish**, which commits them so the live site redeploys.

Decisions made with the owner:

- **Publish commits straight to the deployed branch** (one commit; git history is the undo). No PR flow.
- **Scope: site code, not admin/auth.** Publish refuses changes outside the allowlist in §5.
- **Engine: the provider's own coding CLI** inside the sandbox, chosen from `config/ai.yml` `text.provider`
  and `text.model` (the AI screen): Anthropic → Claude Code, OpenAI → Codex, Google → Gemini CLI.

## Spike findings (live, Vercel Sandbox SDK 3.7.0, 2026-10-12)

1. `source: { type: 'git', url, depth: 1 }` clones into **`/vercel/<RepoName>`**, not `/vercel/sandbox` (the SDK
   docs are wrong for this version). Don't depend on the name: clone ourselves with `git clone … /vercel/site`
   (or read the path back) and use one constant `SITE_DIR` everywhere.
2. The default image ships **pnpm 11**, which ignores `package.json`'s `pnpm.onlyBuiltDependencies` and fails the
   install (`ERR_PNPM_IGNORED_BUILDS`). `npm i -g pnpm@10.28.2` then `pnpm install --frozen-lockfile` works (8 s).
   Read the pnpm version from the repo (`packageManager` if present, else the lockfile's) instead of hard-coding
   it where practical.
3. `pnpm astro dev --host 0.0.0.0 --port 4321 --allowed-hosts` is required; without `--allowed-hosts` Vite
   answers **403** to the `*.vercel.run` host. Clone → install → preview 200 took **13 s**.
4. **Config edits (`config/*.yml`) are not hot-reloaded** by `astro dev` (the page did not change after editing
   `config/site.yml`). Restart the dev server after every agent run; `.astro`/CSS edits hot-reload anyway.
5. Preinstalled: **Claude Code 2.1.283** (`/usr/local/bin/claude`), **codex-cli 0.158.0**. **Gemini CLI is not
   installed**: `npm i -g @google/gemini-cli` at sandbox creation when the provider is Google.
6. **Credential brokering works.** Policy in record form:
   `networkPolicy: { allow: { 'api.openai.com': [{ transform: [{ headers: { authorization: 'Bearer <key>' } }] }], … } }`
   (the array-of-objects form in the skill docs is rejected by the SDK's validator). With `OPENAI_API_KEY=placeholder`
   inside the VM, OpenAI answered `Incorrect API key provided: sk-BROKE*****UMMY`: the firewall's header replaced
   the client's. Claude Code with a placeholder key reached Anthropic (401 on the dummy). Unlisted domains were
   blocked. Codex logs "Falling back from WebSockets to HTTPS transport" and then works over HTTPS.

## 1. Data shape

One sandbox per site, named from the repo (`site-editor-<owner>-<repo>`, sanitized), **persistent** (edits
survive stops; `keepLastSnapshots: { count: 1 }`). Its state file `/vercel/editor/state.json` is the session's
only store (no new table; works in git and Postgres mode):

```ts
interface EditorSession {
  baseSha: string;                       // commit the clone started from
  docVersions: Record<string, string>;   // Postgres mode: document path → version exported into the sandbox
  provider: TextProviderId; model: string;
  runs: { id: string; prompt: string; startedAt: string; finishedAt?: string; exitCode?: number; by: string }[];
}
```

The agent's process writes its output to `/vercel/editor/runs/<id>.log`; "running" = the run has no
`finishedAt` and its pid is alive (a wrapper script writes the exit code to `<id>.exit` when the CLI ends).

## 2. Lifecycle (`src/lib/admin/editor.ts`, injected `SandboxApi` for tests)

- **Start** (`POST /api/admin/editor/session`): `Sandbox.getOrCreate({ name, ports: [4321], persistent: true,
  timeout: 30 min, resources: { vcpus: 2 }, networkPolicy })`. On create: clone the deployed branch
  (`githubConfig(process.env)`, token only for the clone, then `git remote set-url origin <tokenless url>` so no
  token stays in `.git/config`), install, write `state.json`. **Postgres mode**: export every document
  (`store.list`/`read` over `isDocumentPath` paths) into the checkout so the preview shows live content, record
  their versions in `docVersions`. Then (re)start the dev server and wait until `localhost:4321` answers 200.
  Every later call that finds the sandbox resumed restarts the dev server (processes don't survive a stop).
- **Run** (`POST /api/admin/editor/runs` `{ prompt }`): refuse while a run is active (409). Start the CLI
  **detached** through a small wrapper (`bash -lc 'cmd > log 2>&1; echo $? > exit'`), return the run id at once.
  Extend the sandbox timeout. The function never waits for the agent.
- **Status** (`GET /api/admin/editor/session`): exists? running run? last ~200 lines of its log, preview URL,
  changed files (`git status --porcelain=v1 -uall`, renames as delete + add), each marked allowed or refused per
  §5, and the unified diff (capped, e.g. 200 KB). When a run has finished since the last status, restart the dev
  server once (finding 4).
- **Discard** (`DELETE /api/admin/editor/changes`): `git checkout -- . && git clean -fd` (keeping
  `node_modules`, `.astro` and the editor dir) and, in Postgres mode, re-export the documents.
- **End** (`DELETE /api/admin/editor/session`): stop the sandbox (filesystem snapshot kept; the next Start
  resumes it).

All routes sit behind `route()` (signed-in admin). Each sandbox call has a timeout and maps failures to
`UpstreamError` ("Vercel Sandbox: …").

## 3. Agent command per provider

A registry keyed by `TextProviderId` (table over branching), each entry
`{ cli: (model, prompt) => string[], domain, header: (key) => Record<string,string>, envPlaceholder, install? }`:

| provider | command | brokered header | placeholder env |
|---|---|---|---|
| anthropic | `claude -p <prompt> --model <model> --dangerously-skip-permissions --output-format stream-json --verbose` (`--continue` after the first run) | `api.anthropic.com` → `x-api-key` | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` |
| openai | `codex exec --full-auto -m <model> <prompt>` (`codex exec resume --last` style continuation if supported; otherwise fresh) | `api.openai.com` → `authorization: Bearer` | `OPENAI_API_KEY`, `CODEX_API_KEY` |
| google | `gemini -p <prompt> -m <model> --yolo` | `generativelanguage.googleapis.com` → `x-goog-api-key` | `GEMINI_API_KEY` |

Verify each CLI's current headless flags with `--help` inside a sandbox before relying on them. The prompt is
passed as an argv element, never interpolated into a shell string. The real key comes from `getSecret` (admin
screen or env) and goes **only** into the network policy transform; the VM holds the placeholder. A system
preamble (prepended to the owner's request, or the CLI's system-prompt flag) tells the agent: it is editing an
Astro site; change only site code (§5 allowlist); never touch admin, auth, API routes, dependencies or secrets;
keep the light and dark themes and WCAG AA contrast; run `pnpm astro check` before finishing; summarize what it
changed.

Network policy for the session: the provider's domain (with transform) plus `registry.npmjs.org` /
`*.npmjs.org` (installs at creation) and `github.com` / `codeload.github.com` only if the clone needs them after
creation (prefer not). Everything else denied. The key is updated with `sandbox.update({ networkPolicy })` on each
Start and Run so a key changed on the AI screen takes effect.

## 4. Publish (`POST /api/admin/editor/publish` `{ message? }`)

1. Read the changed files from the sandbox (content as base64 for binaries; deletions as `content: null`).
2. Refuse (400, listing paths) if any path is outside §5 or the change set is empty.
3. Split: **document paths** (`isDocumentPath`) vs **code paths**.
   - Git mode: one commit through the GitHub store with every change, base versions = the blob shas at
     `baseSha` (`git rev-parse <baseSha>:<path>`, null for new files) — a file changed on GitHub since the session
     started is a 409 ("the site changed since this session started: discard and start again").
   - Postgres mode: code paths → one GitHub commit as above (needs `GITHUB_TOKEN`); document paths →
     `commitChanges(store, …)` with base = `docVersions`. Code commit first; if the document commit then fails,
     report both outcomes precisely (the code is live, the content is not).
4. Commit message: the owner's, else "Site editor: <first prompt, truncated>", author = the signed-in admin.
5. After success: `git fetch`/reset the sandbox to the new commit (or record the new `baseSha`) so further
   runs start from what is live, and clear the run list. Return the commit URL; the screen says "live in about a
   minute" (Vercel redeploys on push).

## 5. Scope allowlist (`src/lib/admin/editor-scope.ts`, pure, tested)

Allowed: `src/components/**`, `src/layouts/**`, `src/pages/**` (except anything under an `api` segment),
`src/styles/**`, `src/themes/**`, `src/assets/**`, `src/content/**`, `src/data/*.json` except `jobs.json` and
`scholar.json`, `public/**`, `config/*.yml` except `config/ai.yml`.

Refused (wins over allowed): `src/admin/**`, `src/lib/admin/**`, `src/middleware*`, `src/integrations/**`,
`src/lib/db*`, `src/lib/mode*`, `migrations/**`, `scripts/**`, `.github/**`, `package.json`, `pnpm-lock.yaml`,
`astro.config.*`, `vercel.json`, `vercel.ts`, `netlify.toml`, `.env*`, any dot-file or `..` segment, and paths
over 300 chars. `src/lib/**` other than the refused files is **refused** too (shared server code).

The screen shows refused files in red before Publish; the agent preamble names the same rules.

## 6. Admin UI (`src/admin/Editor.vue`, nav "Site editor")

- Not available (explains why) when: static mode; no `GITHUB_TOKEN`/repo; no key for the configured provider.
- **Start session** / **End session**; status line (starting, ready, running, stopped).
- Prompt box + **Run**; while running, the log tail (stream-json rendered as plain text lines for Claude) polled
  every 2 s.
- **Preview**: the sandbox URL in an iframe at desktop width with a phone-width toggle, plus "Open ↗".
- **Changes**: file list (allowed / refused) and a collapsible diff (`<pre>`, no new dependency).
- **Discard changes**, **Publish** (disabled with refused files or no changes; confirm dialog via the existing
  `dialog.ts`).

## 7. Config, docs, dependency

- New dependency: `@vercel/sandbox` (runtime, server-only).
- Auth on Vercel: automatic OIDC. Local dev: `vercel link` + `vercel env pull` for `VERCEL_OIDC_TOKEN`
  (document; `.env.example` comment). Needs `GITHUB_TOKEN` with contents write (already used by git mode and the
  backup).
- README "Site editor" section: what it does, cost (sandbox time billed to the Vercel account; Hobby sessions
  max 45 min), scope rules, that the provider key never enters the sandbox.

## Ceilings (ponytail)

- One session per site; two admins share it (a second Run while one is active is a 409).
- Session timeout 30 min, extended on each Run; Hobby's 45-min session cap ends long sessions (the filesystem
  persists and Start resumes it).
- Diff and log are capped in size for the response; the full diff stays in the sandbox.
