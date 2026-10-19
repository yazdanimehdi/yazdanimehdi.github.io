# Password accounts, local dev on Neon, and sub-project 4 follow-ups — design spec

Date: 2026-10-07 · Status: approved in chat, pending written-spec review
Sub-project 5. Builds on sub-projects 2–4 (admin + `ContentStore`, Postgres mode, jobs).

## Intent

Let the site owner (and other people they add) sign in to the admin with a username and password instead of
GitHub, run the admin locally against a real Neon database branch without risking the live site, and close every
open item left by sub-project 4's reviews.

Success:
- In Postgres mode, an account created with `pnpm admin:create-user` can sign in with username + password; GitHub
  sign-in keeps working where it is configured.
- Admins manage accounts from a Users screen; deleting an account or resetting/changing its password signs that
  account out everywhere on its next request.
- `pnpm dev:postgres` runs the site locally against the Neon `dev` branch with working PDF/image uploads, and can
  never connect to the production database by accident.
- Every finding from sub-project 4 is fixed, or listed under §5.3 with its reason.

Out of scope: password sign-in in git mode (no database) and static hosting (no server); roles/permissions (all
admins are equal); password reset by e-mail; 2FA.

## 1. Accounts (Postgres mode)

### 1.1 Storage — `migrations/002_admin_users.sql`

```sql
create table if not exists admin_users (
  username text primary key,          -- stored lowercase; usernames are case-insensitive
  name text not null,                 -- display name (history/revisions author)
  password_hash text not null,        -- see 1.2
  session_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists login_attempts (
  username text not null,             -- lowercase, as typed (also for unknown usernames)
  at timestamptz not null default now()
);
create index if not exists login_attempts_username_at_idx on login_attempts (username, at desc);
```

Usernames: 1–40 characters of `[a-z0-9._-]`, lowercased on input.

### 1.2 Passwords — `src/lib/admin/passwords.ts`

- `hashPassword(password): Promise<string>`: Node `crypto.scrypt`, 16-byte random salt, N=16384, r=8, p=1, 64-byte
  key; stored as `scrypt$16384$8$1$<salt b64url>$<key b64url>`.
- `verifyPassword(password, stored): Promise<boolean>`: `timingSafeEqual`; unknown format → false.
- Unknown usernames are verified against a fixed dummy hash, so the response time doesn't reveal which usernames exist.
- `assertPasswordPolicy(password)`: at least 12 characters, at most 200; else `HttpError(400)`.

### 1.3 Sessions

- `SessionUser` gains `provider: 'github' | 'password'` and, for password sessions, `version: number` (the
  account's `session_version` at sign-in). The sealed payload carries both. Existing cookies without `provider` read as
  `github` (no forced sign-out on deploy).
- Same cookie (`scholaros_session`), options, 7-day lifetime and same-origin protection as today.
- Middleware (`src/middleware.ts`) accepts a session when:
  - `provider === 'github'`: `isAdminUser(login, adminUsers)` (unchanged);
  - `provider === 'password'`: Postgres mode, and `admin_users` has the username with `session_version === version`.
    One indexed query per admin request. A missing table (pre-migration) → signed out.
- Revisions and history record the account's `name` as author, as they do for GitHub users.

### 1.4 Sign-in — `POST /api/admin/auth/password`

- Body `{ username, password }`. Postgres mode only (else 404). Lives under `/api/admin/auth/` (session check skipped),
  still subject to the same-origin check for POST.
- Throttle: if `login_attempts` has ≥ 10 rows for the username in the last 15 minutes → 429 "Too many attempts; try
  again in 15 minutes" (no password check). Each failure inserts a row; success deletes that username's rows. Rows older
  than 1 day are deleted opportunistically on each attempt.
- Success → sets the session cookie, `{ ok: true }`. Failure → 401 "Wrong username or password" (same message for
  unknown username and wrong password).
- Table missing (migration not applied) → 503 "Password sign-in needs the database migration: run `pnpm db:migrate`".

### 1.5 Login page

`/[adminPath]/login`: in Postgres mode a username/password form (posts to 1.4, shows its error); the "Sign in with
GitHub" button only when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set. Git mode: unchanged.

### 1.6 Users screen and own password

- Screen `/[adminPath]/users` (nav item "Users"), Postgres mode only (git mode: nav item hidden, routes 404).
- Lists accounts (username, name, created). Any admin can:
  - add an account: username, display name, initial password (policy 1.2);
  - reset an account's password (bumps its `session_version`);
  - delete an account — refused for your own account and for the last remaining account (409 with a message).
- Change own password (password sessions only): current password + new password twice; bumps `session_version` and
  re-seals the current cookie with the new version (other devices are signed out, this one stays).
- GitHub admins (`site.yml` `adminUsers`) are listed read-only under "GitHub admins (managed in site.yml)".
- API (session + same-origin):
  - `GET /api/admin/users` → `{ accounts: [{ username, name, created_at }], githubAdmins: string[] }`
  - `POST /api/admin/users` `{ username, name, password }` → 201; 409 if the username exists
  - `PUT /api/admin/users/[username]` `{ password }` → reset
  - `DELETE /api/admin/users/[username]`
  - `POST /api/admin/account/password` `{ current, next }` → 400 wrong current / policy; 404 for GitHub sessions

### 1.7 First account — `pnpm admin:create-user <username>`

`scripts/admin-create-user.ts`: loads `.env.local`; prompts for display name and password (hidden input, asked
twice); applies migrations; inserts the account (or, with `--reset`, replaces an existing account's hash and bumps its
version). Database: `DEV_DATABASE_URL` by default; with `--production`, `DATABASE_URL`, after printing its host and
requiring the username to be typed again.

## 2. Local development on the Neon `dev` branch

- One-time (README "Local development against Neon"): create a Neon branch `dev` from `main`; `vercel link`;
  `vercel env pull .env.local --environment=preview`; add `DEV_DATABASE_URL=<dev branch connection string>` to
  `.env.local`; `pnpm admin:create-user <you>`.
- `pnpm dev:postgres` → `scripts/dev-postgres.ts`:
  - loads `.env.local`; exits with instructions if `DEV_DATABASE_URL` is missing; prints the host it uses;
  - applies migrations to `DEV_DATABASE_URL`;
  - spawns `astro dev` with env from an exported pure function `devEnv(fileEnv, shellEnv)` that sets `VERCEL=1`,
    `DATABASE_URL=DEV_DATABASE_URL`, and passes `SESSION_SECRET`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`,
    `GITHUB_*`, `MEDIUM_TOKEN` through; the pulled `DATABASE_URL` is never used.
  - Missing `SESSION_SECRET` → generated per run (sessions then last until restart), with a notice.
- Locally the CDN purge is a no-op (no CDN); Blob uploads go to the real store with content-hashed names.

## 3. Production rollout

- `pnpm db:migrate` (reads `.env.local`'s production `DATABASE_URL`, as today) applies `002`.
- `pnpm admin:create-user <username> --production` creates the first live account.
- Deploying before the migration is safe: password sign-in answers 503 (1.4), GitHub sign-in works.

## 4. Demo content

`config/feeds.yml`: `feeds: []`, with the two example feeds kept as comments, so a fresh site's daily job reports
"no feeds configured" instead of failing on placeholder URLs.

## 5. Sub-project 4 follow-ups

### 5.1 Fixes

CV PDF:
- `affectsCvPdf` includes `config/site.yml` (the author name is bold in the PDF).
- `generateCvPdf`: if the `cv.json` commit fails after the upload, delete the uploaded blob (best effort) before
  rethrowing; if the `cv.json` commit's cache purge failed, return that warning so the save reports it.
- `POST /api/admin/cv/pdf`: `ConflictError` passes through as 409.
- `Cv.vue`: refreshes PDF info after a history restore (any document reload).
- `render.ts`: the local-access policy compares `path.resolve(p)` against the fonts directory.
- Tests: `cache-purge-failed` wins over `pdf-failed`; a `config/cv-upload.yml`-only save regenerates; `committed()`
  shows the `pdf-failed` toast (`src/admin/api.test.ts`).

Daily jobs:
- `parseJobs` keeps only well-formed step records (`ok` boolean, `at` valid ISO date, optional string
  `detail`/`url`).
- `BackupResult` loses the unused `skipped`/`error` fields.
- Tests: the cron answers 502 when a step fails; Run now writes `jobs.json`; a post dated exactly `since` is not
  released, one dated exactly `now` is.

Medium:
- Git-mode read-after-write: the editor sends the version it just saved; the route re-reads up to 3 times, 500 ms
  apart, until the stored version matches; still stale → 409 "The post is still saving; try again in a moment".
- "Sent to Medium (url), but saving the link failed" → the editor shows the URL to paste and no Retry; the route
  returns `{ details: { url } }` with that 502.
- 409 "Already on Medium" → treated as success: the editor fills `medium.url` from `details.url` and reloads.
- `absoluteUrls` leaves inline code and fenced code blocks unchanged and handles one level of balanced `(...)`
  inside a link target.
- Scheduled posts (date in the future) are refused: 400 "Send this post to Medium once it is live (<date>)"; the
  editor offers the checkbox only for published posts.
- Dedupe `normalLink` ignores the scheme and a leading `www.`; an empty normalized title never matches.
- Tests: MDX post → 409; `siteUrl` missing → post URL from the request origin; scheduled refusal; code-span
  preservation; dedupe scheme/www.

Repo and CI:
- `.github/workflows/sync-template.yml`: `git diff --binary` (fonts no longer abort the patch).
- README: wrap the long Postgres-mode step-1 line.
- `src/lib/cv-pdf/generate.test.ts`, `src/lib/admin/jobs.test.ts`: `/* eslint-disable no-console */` at the top, as in
  existing tests that silence logs.

### 5.2 Already fixed in sub-project 4's final pass

Import to Medium uses the public `siteUrl`; `medium.url` restricted to http(s); 26 h release window; legacy
`backup.json` excluded from backup; Dashboard refreshes after Run now; fonts listed only in Postgres mode.

### 5.3 Left as is

- A draft dated in the future shows "Schedule" on the primary button: correct, that button publishes it for that date.
- Repeated setup steps across three workflow jobs: normal for GitHub Actions; a composite action adds more moving
  parts than it removes.
- No node test for future-dated posts in static mode: `astro:content` can't load under `node:test`; the static build
  covers it.

## 6. Testing (`node:test`, PGlite for database tests)

- Passwords: hash/verify round trip; wrong password; malformed stored hash; dummy-hash path for unknown usernames.
- Accounts: create/reset/delete; refuse deleting self and the last account; duplicate username 409; username rules.
- Throttle: 10 failures → 11th answers 429 even with the right password; after 15 minutes (injected clock) allowed;
  success clears the username's attempts.
- Sessions: old cookie without `provider` → github; password session accepted only while the account exists and the
  version matches; reset → old session rejected; own change → current cookie re-sealed and accepted, older one
  rejected.
- Middleware: password routes 404 in git mode; same-origin required on the new mutating routes; Users routes need a
  session.
- Pre-migration: sign-in route 503 with the migration message; middleware treats password sessions as signed out.
- Scripts: `devEnv` maps `DEV_DATABASE_URL` → `DATABASE_URL`, ignores the file's `DATABASE_URL`, sets `VERCEL=1`;
  missing `DEV_DATABASE_URL` → error; `admin:create-user --production` requires the typed confirmation (pure
  confirmation function tested).
- Each §5.1 item: the test named there.
- Manual (owner): on the `dev` branch locally — password sign-in, add/remove a second account, change own password,
  Generate PDF, Run now, Medium import; then `db:migrate` + `admin:create-user --production` and sign in on the live
  site.
