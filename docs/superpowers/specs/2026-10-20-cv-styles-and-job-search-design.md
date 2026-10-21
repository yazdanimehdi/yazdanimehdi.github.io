# CV styles, job search, and assisted applying

Date: 2026-10-20 · Status: draft for approval

## Intent

The site should act like a living assistant for the owner's job hunt. Every night it looks for jobs that fit the
owner, prepares tailored materials for the best ones, pre-fills the application, and asks for approval. The owner opens
the admin, reviews, and approves. Nothing goes out without that approval.

ScholarOS is a forkable template, so "the owner" means whoever runs a copy. Nothing about one person's search is
hardcoded; everything is set in the admin.

Prior art: [ai-job-search](https://github.com/MadsLorentzen/ai-job-search) (MIT). It is a Claude Code workflow on local
files. We port its ideas (scoring framework, posting guard, drafter-then-reviewer pass, no-fabrication rule, data
fields, statuses) into the site's backend. We don't run the repo itself.

Three projects, built in this order. Each one is useful on its own.

1. **CV styles.** RenderCV makes every CV PDF, with styles configured in the admin.
2. **Job pipeline.** Search, score, a job page, tailored CV and cover letter.
3. **Assisted applying and automation.** Pre-fill forms, approve, submit; nightly automation with notifications.

## Goals

- A CV PDF that is compact by default, with many looks to choose from, all configurable in the admin.
- The owner describes what they want once (in the admin) and gets a ranked feed of matching jobs every morning.
- Each job has one page holding everything about it: posting, fit, tailored CV, cover letter, form answers, the
  application, status, and history.
- The owner chooses which AI does the work: the API providers already wired in (Claude, OpenAI, Gemini), or the agent
  CLIs (Claude Code, Codex, Antigravity) running in Vercel Sandbox. Each is authenticated by API key or by subscription.
- The owner controls how far the nightly run goes.

## Non-goals

- Submitting anything without explicit per-application approval. There is no setting that turns this off (see
  anti-goals).
- Sending email to employers (follow-ups, replies). Out of scope; may come later, also behind approval.
- Gmail/Notion sync, interview prep, and upskilling from ai-job-search. Later, if wanted.
- Job search in the static and git modes. It needs the database and the cron, so it is postgres mode only and hidden
  elsewhere. CV styles work in all modes.

## Anti-goals (a failure even if it technically works)

- A tailored CV or cover letter that claims experience, skills, or results the owner doesn't have.
- Anything submitted without the owner's approval, or submitted with values different from what they approved.
- Instructions planted in a job posting steering the AI (prompt injection).
- Getting the owner's accounts banned. Scraping sources that forbid it is opt-in and off by default.
- A runaway night that burns a subscription's quota or a large API bill.
- Secrets (API keys, subscription tokens) appearing in the git backup, logs, or the browser.

## Existing system (what this builds on)

- Astro 5 + Vue admin, three modes (`src/lib/mode.ts`): static, git, postgres. Postgres mode is Vercel serverless +
  Neon (`postgres.js`, raw SQL migrations in `migrations/`), functions capped at `maxDuration: 300`.
- Admin screens: `src/admin/*.vue`, registered in `src/admin/routes/[...path].astro` (`SCREENS`) and `AdminShell.vue`
  (`GROUPS`); API routes under `src/admin/routes/api/**` wrapped in `route()` (`src/lib/admin/http.ts`). Config files are
  allowlisted in `CONFIG_FILES` (`src/lib/admin/paths.ts`) and edited via `Settings.vue`-style declarative fields.
- Nightly run: Vercel Cron → `/api/admin/cron/daily` at 03:00 UTC → `runJobs` (`src/lib/admin/jobs.ts`), a sequential
  list of steps that each record a result. Note that "jobs" here means scheduled tasks; the job-search code needs a
  name that doesn't collide (e.g. `career/`, `openings`).
- AI: raw-fetch providers in `src/lib/ai/providers.ts`; keys sealed in the `secrets` table (`src/lib/admin/secrets.ts`).
- Agent CLIs: the Site editor (`src/lib/admin/editor.ts`, `sandbox.ts`) already runs `claude -p`, `codex exec`, and
  `gemini` inside Vercel Sandbox with a network policy. This is the pattern to reuse for agent work.
- CV today: two renderers. In postgres mode, pdfmake (`src/lib/cv-pdf/`) with hardcoded, loose spacing (54pt margins,
  12pt section gaps), regenerated on CV saves (`affectsCvPdf`). In static/git modes, RenderCV via GitHub Actions
  (`scripts/render-cv.py`, `.github/workflows/render-cv.yml`, which still installs TeX Live it no longer needs). CV
  data is RenderCV-shaped (`config/cv.yml`, `config/cv-upload.yml`).

## Decided after review

- **One job search per site, owned by the owner.** It runs off the site CV (`config/cv.yml`). Only the owner can see the
  job-search screens, data, and AI credentials, and only the owner can approve or submit. Other admins never see it, so
  no per-user scoping is needed in the tables.
  - Claude's call: the owner is designated explicitly by an `owner` setting naming one admin account, defaulting to
    the first `adminUsers` entry.
  - Per-person lab CVs (`cv/*.yml`) are not part of job search, and keep rendering as they do today.
- **Subscription credential files inside Sandbox are acceptable.**
  - Codex's `auth.json`, and the Claude Code OAuth token where header injection doesn't work, may be written into the
    VM for the length of a run.
  - The sealed copy in `secrets` is the source of truth, and refreshed tokens are written back to it after the run.
  - The file is deleted with the VM and never enters documents, logs, or the backup.
  - API keys keep using header injection as today.
- **Font spans (`[text]{.mono}`) may be lost in the PDF.** They stay a website-only feature, and RenderCV prints the
  plain text as `render-cv.py` already does. The README line that says the PDF shows them must be updated.

## Project 1: CV styles (RenderCV)

**Decided:**

- RenderCV is the only CV PDF engine in every mode. pdfmake goes away.
- An admin screen, **CV → Styles**, as in the approved mockup:
  - **Built-in styles:** RenderCV's themes (classic, sb2nov, engineeringresumes, moderncv, engineeringclassic, harvard,
    ink, opal, ember, or whatever the installed version ships).
  - **My styles:** the owner saves named styles. Each is either a built-in theme plus design overrides, or an uploaded
    custom RenderCV theme (its template files).
  - **Settings:** every RenderCV design option, grouped into Page, Text, Spacing, Colors, plus an Advanced raw-YAML
    view of the design block.
  - **Density presets:** Compact, Normal, and Airy fill in the spacing values.
  - **Live preview:** re-renders as settings change.
  - **Public download:** one style is the public CV download.
- The default for new and existing sites is a compact style, tighter than today's PDF.
- Styles are reusable by name, so project 2 can render each tailored CV in a chosen style.

**Left to the builder:**

- Where RenderCV runs in postgres mode: a Vercel Python function or Vercel Sandbox. Pick by cold-start speed and
  preview latency; the preview must feel responsive (debounced re-render is fine).
- How styles are stored (a new config file such as `config/cv-styles.yml` on the `CONFIG_FILES` allowlist is the
  obvious fit). Uploaded theme files go wherever media goes in each mode.
- How the GitHub Actions path picks up the selected style, and dropping its TeX Live install.
- Validating uploaded themes and design YAML so a bad style fails with a clear message, never a broken public PDF.
  Keep the last good PDF.

**Calls made by Claude for project 1:**

- **Where the Styles screen exists:**
  - **Custom admin (git and postgres modes):** the Styles screen with live preview is there, so the RenderCV renderer
    is deployed on Vercel in both of those modes for previews.
  - **Git mode:** the published PDF can keep coming from GitHub Actions.
  - **Static mode (Sveltia):** gets plain style fields and no preview.
- **Migrating existing sites:** an existing `design:` block in `config/cv.yml` or `cv/*.yml` that has real overrides
  becomes a "My style" and stays selected, so that PDF doesn't change. A block that only names a theme becomes that
  theme with Compact density.
- **Precedence:** when the raw upload (`cv-upload.yml`) is enabled and carries its own `design`, the upload wins. It
  exists to be used verbatim.

## Project 2: job pipeline

### Preferences (admin → Job search)

- **What the owner wants:**
  - target roles and keywords
  - seniority
  - locations and remote/hybrid
  - languages
  - salary floor
  - fields and industries
  - must-haves and deal-breakers
  - companies to avoid
- **Profile:** the CV is the base profile, and these preferences refine it.
- **Fit threshold:** a score from 0 to 100.
- **Sources:** each one toggles on or off, with any keys it needs.
- **Watched companies:** a list of company careers URLs.
- **Application answers** (Claude's call): facts that forms ask for but a CV doesn't hold. These are the only source
  for such fields; anything missing means hand-off, never a guess.
  - work authorization and visa sponsorship
  - notice period and earliest start
  - salary expectation (separate from the floor)
  - phone and address
  - links
  - a reusable "why I'm looking" blurb
  - **EEO/demographic questions:** the default is "decline to answer", and the owner can change it.

### Sources (each a small plugin with the same search/detail contract)

- **Open boards** with public feeds or APIs, e.g. Remotive, RemoteOK, Arbeitnow, Adzuna (free key), freehire.me,
  USAJobs (free key), and academic boards (EURAXESS, jobs.ac.uk, Nature Careers, HigherEdJobs, AcademicJobsOnline)
  where they offer feeds.
- **Google Jobs via SerpAPI.** The `SERPAPI_KEY` secret already exists. This is the broad net over boards we don't have
  plugins for.
- **Company boards the owner adds:**
  - If the URL uses a known applicant-tracking system (Greenhouse, Lever, Ashby, Workable, SmartRecruiters), read its
    public job JSON directly.
  - For any other careers page, fetch it (respecting robots.txt) and extract the postings with the AI.
- **LinkedIn guest search:** available but off by default, with a terms-of-service warning in the admin.
- "All the boards" means as many as is practical. Adding a source should be one file.

### Nightly pipeline

1. Gather new postings from enabled sources.
2. Deduplicate them against everything seen before, keyed on company + title + URL.
3. Apply hard gates (location, language, deal-breakers).
4. Score each posting with ai-job-search's framework:
   - technical skills 30%
   - experience 25%
   - culture/behavioural fit 15%
   - career alignment 30%
   - location pass/fail

   Each posting gets one structured-output AI call, which returns sub-scores, strengths, and gaps. Low scorers stay
   visible but are collapsed, never deleted.
5. Rank the matches on the dashboard.

### The job page (one per posting)

- **Posting:** the full text, run through a posting guard ported from `posting_guard.py`. It strips hidden or
  zero-width text and flags injection-like lines before any AI sees it. The original link is kept.
- **Fit:** the score breakdown, strengths, and gaps.
- **Tailored CV:** a RenderCV document derived from the owner's CV, rendered in a chosen style (project 1).
- **Cover letter.**
- **Form answers:** answers to the application form's own questions. In project 2 this covers only systems that expose
  their questions through an API (e.g. Greenhouse). Everything else gets form answers in project 3, once the browser
  can read the form (Claude's call).
- **Status** (from ai-job-search, plus the found and ready states):
  - found
  - skipped
  - drafted
  - ready for approval
  - submitted
  - interview
  - offer
  - rejected
  - no response
  - withdrawn
- **History and notes:** a timeline of what happened, plus free-form notes.
- **Editing:** everything is editable, and any piece can be regenerated with an instruction ("shorter", "lead with the
  ML work").
- **Drafting:** follows ai-job-search's drafter-then-reviewer pass. A **hard rule:** the AI may only reorder, select,
  condense, and reword what's in the owner's CV and profile. It never adds claims. The reviewer pass checks for this
  explicitly.

## Project 3: assisted applying and automation

### Applying (always with approval)

1. A headless browser (Playwright in Vercel Sandbox) opens the real application form. It fills every field, uploads
   the tailored CV and cover letter, and stops before Submit.
2. The job page shows screenshots of the filled form and a list of every field and its value.
3. The owner approves, edits values, or skips. Only approval submits.
4. Submission must use exactly the approved values. If the live form no longer matches what was approved (fields
   changed, extra questions appeared), it stops and asks again rather than improvising.
5. After submitting, it saves a confirmation screenshot and sets the status to submitted.
6. It stops and hands the job to the owner whenever it meets a captcha, an account creation or login (Workday and
   similar), or a question it isn't confident about. The page then shows "finish this one yourself", with a link and
   all the prepared materials.
7. An "Approve all ready" button exists as a convenience. It still approves each job individually; it never adds a
   blanket permission.

### The AI worker (admin → Job search → AI)

- **Worker choice:** API providers (Claude, OpenAI, Gemini, using the existing keys) or agent CLIs in Vercel Sandbox
  (Claude Code, Codex, Antigravity). Form filling always runs in Sandbox, whichever worker drafts.
- **Authentication, both per tool, configurable in the admin:**
  - **API key:** the existing sealed secrets.
  - **Subscription:** Claude Code via a long-lived token from `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`), and
    Codex via the auth file from a ChatGPT sign-in. Both are stored sealed in `secrets`, never in documents or the
    backup.
- **Antigravity:** the builder must verify that Antigravity has a headless CLI usable in a sandbox. If it doesn't, offer
  Gemini CLI (already supported by the Site editor) under that slot and say so in the admin.
- **Quota exhausted:** when a subscription runs out of quota, the run stops and reports it. It does not silently fall
  back to paid API usage.

### Nightly automation and how far it goes

- **Stopping point:** the owner picks where the nightly run stops. Each stage includes the ones before it:
  1. search only
  2. + score
  3. + tailor CV and cover letter for matches above the threshold
  4. + pre-fill the application and mark it "ready for approval"
- **Default:** stage 3, which is what the owner described. Submission is never a nightly stage; it only happens on
  approval.
- **Limits:**
  - max drafts per night
  - max applications per company in a window
  - a master pause switch
- **Notifications:**
  - **Dashboard:** a badge and a "Ready for approval" list.
  - **Email digest:** sent via Resend, with the key in the admin, and can be switched off. The site sends no email
    today, so this adds Resend.

### Constraints the builder must respect

- **Run length:** functions stop at 300 s, and Vercel Cron fires the daily route once. The pipeline (many AI calls,
  browser sessions) won't fit in one invocation. It must be resumable and chunked (e.g. Vercel Queues/Workflow, a
  Sandbox-hosted run, or self-continuing batches), and every step must be safe to re-run. Pick the mechanism.
- **Cron:** job search becomes a step in (or is triggered from) the existing nightly run. It doesn't need its own cron.
- **Storage:** job data goes in new Postgres tables via a new migration, not in `documents`. Tailored CV/letter PDFs and
  screenshots go to Blob.
- **Secrets and network:** subscription tokens and API keys enter Sandbox only through the existing network-policy
  mechanism. Agents never see more secrets than their task needs.
- **Posting text is untrusted data** everywhere it flows: AI prompts, the job page (escape it), and the browser
  agent.

## Calls made by Claude (not explicitly decided by the owner)

- Compact density is the new default style.
- LinkedIn is off by default.
- Postgres mode only for job search.
- Submission cannot be made automatic, even by setting.
- Nightly default stage is 3 (tailor), per the owner's description of "tailor, then notify for approval"; stage 4 is
  available.
- Resend for the email digest; dashboard notification always on.
- Antigravity falls back to Gemini CLI if no usable CLI exists.
- Owner = an explicit `owner` setting, defaulting to the first `adminUsers` entry.
- Styles screen with preview in git and postgres modes; plain fields in static mode.
- Existing `design:` blocks migrate to a selected "My style"; a raw upload's own design wins.
- An "Application answers" profile, with EEO questions defaulting to "decline to answer".
- Form answers for non-API forms move to project 3.
