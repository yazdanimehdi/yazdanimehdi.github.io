# AI assist: write/rewrite, cover images, Scholar papers, paper posts — design spec

Date: 2026-10-12 · Status: decisions approved in chat

## Intent

Four admin features, using the owner's own provider keys:

1. **AI write / rewrite** in the post and news editors (OpenAI, Anthropic or Google).
2. **Image generation** for posts and news (OpenAI, Google or Higgsfield): a button in both editors, and
   automatic covers for AI-written paper posts.
3. **Paper posts**: when a new paper is found, the AI writes a blog post about it, saved as a **draft**.
4. **Paper fetching from Google Scholar** through SerpApi's Google Scholar Author API, in the daily cron and a
   "Check now" button.

Decisions made with the owner:

- API keys are **typed into the admin page** and stored encrypted in Postgres. Git mode has no database, so
  there the admin shows each key's env-var status read-only. Env vars are the fallback in both modes.
- Scholar source: **SerpApi** (`SERPAPI_KEY`), not scraping and not OpenAlex.
- Paper posts are **drafts**, never published automatically.
- Images: **button in the editors + automatic for AI paper posts** only. No generation on ordinary saves.

## 1. Secrets (`src/lib/admin/secrets.ts`, `migrations/003_secrets.sql`)

```sql
create table if not exists secrets (
  name text primary key,
  value text not null,          -- base64url(iv ‖ AES-GCM(plaintext))
  updated_at timestamptz not null default now(),
  updated_by text
);
```

- One registry, the only list of key names anywhere:
  `SECRETS = { OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, HIGGSFIELD_API_KEY, HIGGSFIELD_API_SECRET,
  SERPAPI_KEY }` with a label each. Unknown names are a 400.
- Encryption: AES-GCM key derived with HKDF from `SESSION_SECRET` exactly like `session.ts`'s `sessionKey`, but
  salt `scholaros-secrets`. A value that no longer decrypts (SESSION_SECRET rotated) reads as unset and the admin
  says "stored key can't be decrypted, enter it again".
- `getSecret(name)`: Postgres row (decrypted) → `process.env[name]` → undefined.
- `listSecrets()`: `{ name, label, source: 'admin' | 'env' | null, last4?: string }[]`. **Never** returns a value.
- `setSecret(name, value | null, by)`: Postgres mode only (`postgresOnly`), null deletes.
- The `secrets` table is not under `documents`, so the git backup never sees it. Keep it that way.

API: `GET /api/admin/ai/keys` → listSecrets; `PUT /api/admin/ai/keys` `{ name, value }` (value `null` or `''`
clears). Both behind `route()` (signed-in admin).

## 2. Providers (`src/lib/ai/providers.ts`)

Two registries keyed by provider id; each entry is a plain function taking `(key, model, input, fetchFn = fetch)`.
No SDK dependencies: plain `fetch` with `AbortSignal.timeout`. Errors throw `AiError` with the provider's own
message (401 → "OpenAI rejected the key").

Text (`TEXT_PROVIDERS`), input `{ system, prompt, maxTokens }` → `string`:

| id | key | request |
|---|---|---|
| `openai` | OPENAI_API_KEY | `POST https://api.openai.com/v1/chat/completions` |
| `anthropic` | ANTHROPIC_API_KEY | `POST https://api.anthropic.com/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01` |
| `google` | GEMINI_API_KEY | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, `x-goog-api-key`, `systemInstruction` |

Image (`IMAGE_PROVIDERS`), input `{ prompt }` → `{ bytes: Uint8Array, contentType }`, landscape, JPEG or WebP
where the API allows it (uploads are capped at 4 MB by `prepareUpload`):

| id | key(s) | request |
|---|---|---|
| `openai` | OPENAI_API_KEY | `POST /v1/images/generations` `{ model, prompt, size: '1536x1024', output_format: 'jpeg' }` → `data[0].b64_json` |
| `google` | GEMINI_API_KEY | `generateContent` on an image model → first `inlineData` part |
| `higgsfield` | HIGGSFIELD_API_KEY + _SECRET | `POST https://api.higgsfield.ai/<model path>` `{ prompt }` with `Authorization: Key <id>:<secret>`, `Idempotency-Key: <uuid>`; poll `GET /requests/{id}/status` until `completed` (`images[0].url`, then download, https only) or `failed`/`nsfw`/`canceled` (error). Poll every 2 s, give up after 120 s. |

Default models live next to the registries (`DEFAULT_MODELS`). Verify current model ids against the providers'
docs at implementation time; the owner can change them in the admin.

## 3. AI settings (`config/ai.yml`, Scholar id in `config/scholar.yml`)

`config/ai.yml` (new CONFIG_FILE, permissive schema, safe to commit, holds no secrets):

```yaml
text: { provider: anthropic, model: <default> }
image: { provider: openai, model: <default> }
papers:
  autoPost: true      # write a draft post for each new paper
  maxPostsPerRun: 3   # ponytail: bounds one cron run's time and spend
```

`config/scholar.yml` already holds `authors[].scholar_id` for the Python sync; add it to CONFIG_FILES so the admin
edits the same file both pipelines read. Server code fills missing values from defaults; an unset provider key
is a 400 naming the key and the AI screen.

## 4. Write / rewrite (`POST /api/admin/ai/text`)

Body `{ action: 'write' | 'rewrite', collection: 'posts' | 'announcements', instruction?, title?, body? }` →
`{ text }`. Pure prompt builders in `src/lib/ai/prompts.ts` (testable without network):

- `write`: draft a Markdown body from the title, subtitle and instruction; an existing body counts as notes.
- `rewrite`: rewrite the body per the instruction (default "tighten and clarify"), keep Markdown, math (`$…$`),
  links, images and code blocks intact.
- Output: Markdown only, no front matter, no surrounding code fence (strip one if the model adds it).

## 5. Image generation (`POST /api/admin/ai/image`)

Body `{ collection, title, excerpt?, prompt? }`. Builds an editorial-illustration prompt (no text in the image,
no logos, no faces of real people) unless `prompt` is given, generates, runs the bytes through `prepareUpload`
(type sniff + size cap + content-hash name `<slug>-<hash>.<ext>`), then `store.putMedia('content', …)`. Returns
the `UploadResult`; the editor puts `url` into `coverImage` (posts) or `image` (announcements).

## 6. Papers (`src/lib/admin/papers.ts`, `src/data/scholar.json`)

State file `src/data/scholar.json` (added to the write allowlist like `jobs.json`, admin-only, never rendered):

```json
{ "seen": ["<citation_id>", "…"], "lastRun": "<iso>" }
```

`syncPapers(store, deps, now)`:

1. Read `scholar.yml` authors, `ai.yml`, `scholar.json`, existing publications.
2. For each author: `GET https://serpapi.com/search.json?engine=google_scholar_author&author_id=…&sort=pubdate&num=100`
   → `articles[]` (`title`, `link`, `citation_id`, `authors`, `publication`, `year`). Parse defensively.
3. New = citation ids not in `seen`. **First run (no `scholar.json`)** is a baseline: import missing
   publications, mark everything seen, write **no** posts. Without this a first sync writes a post for every paper.
4. A new article whose normalized title matches an existing publication is only marked seen (manual entries win).
5. Otherwise build a publication entry (port `generate_id`, `infer_type`, venue/year parsing from
   `scripts/sync-scholar.py`; slug collisions get `-2`, `-3`). Fetch the abstract with one
   `view_op=view_citation&citation_id=…` call (`citation.description`) only for papers that get a post.
6. Paper posts (when `autoPost`, at most `maxPostsPerRun`, newest first). Papers past the cap are left out of
   this run entirely (not imported, not marked seen), so the next run picks them up with their posts; they are
   listed in the result as `deferred`. The text provider returns JSON `{ title, subtitle, excerpt, tags, body }` (parse; on bad
   JSON, fail that post only). Post front matter: `draft: true`, `date: today`, `relatedPublication: <pub slug>`,
   `coverImage` from §5 (image failure leaves the post without a cover and is reported, not fatal).
7. One `commitChanges` with every new publication, every new post and `scholar.json` (base versions from step 1),
   so a crash mid-run writes nothing and the next run retries. Images were uploaded before the commit; an
   abandoned image is harmless (content-addressed, re-used on retry).
8. Return `{ imported: string[], posts: string[], deferred: string[], failed: { item, error }[] }`. A paper whose
   post failed is still imported and marked seen (the failure is reported; the owner can write it with §4).

Idempotent: the `seen` list is committed in the same commit as the entries, so a rerun never duplicates, and a
publication the owner deletes stays deleted.

Triggers:

- Daily cron (Postgres mode): new step `papers` in `JOBS`, ordered `['scheduled', 'feeds', 'papers', 'backup']`
  so the backup includes the new drafts. No `SERPAPI_KEY` or no Scholar id → `detail: 'skipped: …'`, ok.
- `POST /api/admin/papers/sync` ("Check now" on the AI screen), both modes.
- Git mode keeps the weekly Python GitHub Action as is.

## 7. Admin UI

- New screen `/admin/ai` (nav item "AI"), `src/admin/Ai.vue`:
  - **API keys**: one row per registry entry: label, status ("set in admin · …1234", "from environment",
    "not set"), password input + Save, Clear. Git mode: status only, with "set it as an env var in Vercel".
  - **Writing model** and **Image model**: provider select + model text field (saves `config/ai.yml`).
  - **Papers**: Scholar author id (saves `config/scholar.yml`), "Write a draft post for each new paper",
    "Posts per run", **Check now** with the result (imported / drafted / failed), last run from `scholar.json`.
- `src/admin/AiAssist.vue`, used by `PostEditor.vue` and by `Collection.vue` for `announcements` only: an
  instruction box, **Write**, **Rewrite**, **Generate image**, and **Undo** (restores the body or image from before
  the last AI change). Writes go into the open document as unsaved edits; nothing is committed until the owner
  saves. Buttons disable while a request runs; errors toast through `report`.

## 8. Config & docs

- `.env.example`: `SERPAPI_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `HIGGSFIELD_API_KEY`,
  `HIGGSFIELD_API_SECRET` (all optional; Postgres mode can set them on the AI screen instead).
- README: "AI assist" section (keys, models, what is sent to providers, paper drafts, cost note).

## Ceilings (ponytail)

- `maxPostsPerRun` (default 3) bounds a cron run under the 300 s function limit; more new papers wait a day.
- Encryption key derives from `SESSION_SECRET`; rotating it means re-entering the keys.
- SerpApi free tier (~250 searches/month) covers one author daily plus abstracts for a few new papers.
