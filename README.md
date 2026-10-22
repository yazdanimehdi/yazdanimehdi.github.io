<p align="center">
  <img src="assets/logo.png" alt="ScholarOS Logo" height="200">
</p>

<h3 align="center">ScholarOS</h3>

<p align="center">
  A living operating system for academic and research websites.
  <br>
  Designed for researchers, professors, and labs who want their public presence to stay current by default.
  <br>
  Built with <strong>Astro 7</strong>, <strong>Vue 3</strong>, and <strong>Tailwind CSS v4</strong>.
  <br><br>
  <a href="https://github.com/yazdanimehdi/ScholarOS/stargazers">
    <img src="https://img.shields.io/github/stars/yazdanimehdi/ScholarOS?style=social" alt="GitHub Stars">
  </a>
  <a href="https://github.com/yazdanimehdi/ScholarOS/network/members">
    <img src="https://img.shields.io/github/forks/yazdanimehdi/ScholarOS?style=social" alt="GitHub Forks">
  </a>
  <br>
  <a href="https://github.com/yazdanimehdi/ScholarOS/actions/workflows/deploy.yml">
    <img src="https://github.com/yazdanimehdi/ScholarOS/actions/workflows/deploy.yml/badge.svg" alt="Deploy Status">
  </a>
  <a href="https://github.com/yazdanimehdi/ScholarOS/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/yazdanimehdi/ScholarOS?color=blue" alt="License">
  </a>
  <a href="https://github.com/yazdanimehdi/ScholarOS/releases">
    <img src="https://img.shields.io/github/v/release/yazdanimehdi/ScholarOS" alt="Latest Release">
  </a>
  <a href="https://github.com/yazdanimehdi/ScholarOS/contributors">
    <img src="https://img.shields.io/github/contributors/yazdanimehdi/ScholarOS?color=brightgreen" alt="Contributors">
  </a>
</p>

<p align="center">
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#content-collections">Content</a> &bull;
  <a href="#automation-workflows">Automation</a> &bull;
  <a href="#migration-from-al-folio">Import Existing Sites</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

**ScholarOS** is a free, open source academic website system that treats your site as a _living research surface_, not a static brochure.

It is built for people who publish papers, recruit students, run labs, maintain CVs, announce results, and share ideas continuously — and who are tired of manually updating websites to keep up.

ScholarOS combines a static, performance-first architecture with a CMS, automation workflows, and data-driven views so that your site stays accurate, fresh, and coherent with minimal effort.

You can use it for a personal academic site or a multi-member research lab.  
The same system supports both.

Fork it, edit a few YAML files, push once, and your site deploys automatically.

---

## Why ScholarOS exists

Most academic websites fail for the same reason: **maintenance cost**.

Static templates are excellent for publishing content, but they break down when:

- multiple people need to edit the site
- publications need regular updates
- CVs drift out of sync with PDFs
- blog posts and announcements become infrequent
- labs grow, rotate members, and change focus

ScholarOS is designed around a different assumption:

> Your website should update itself whenever possible,  
> and be easy to update when automation is not enough.

This is why ScholarOS is closer to an operating system than a theme.

---

## What makes ScholarOS different

- **CMS-driven editing**  
  Publish blog posts, announcements, people profiles, and CV updates through a browser-based admin panel. No Git knowledge required for contributors.

- **Automation-first design**  
  Scheduled workflows keep publications, feeds, and generated artifacts up to date. Manual work is the exception, not the rule.

- **Data as the source of truth**  
  Publications, CVs, people, and research areas live in structured YAML and Markdown, not hard-coded layouts.

- **Static by default, interactive where needed**  
  Astro’s island architecture keeps pages fast and stable, while Vue powers search, filters, forms, and admin-facing interactions.

- **Built to grow with you**  
  ScholarOS starts simple, but supports future extensions such as dashboards, interactive demos, internal pages, and richer automation without replatforming.

---

## Personal site and lab site, one system

ScholarOS supports two modes controlled by a single configuration flag:

- **Personal mode** for individual researchers
- **Lab mode** for research groups with many members

The same content model, automation, and workflows power both.

You do not need separate templates.

---

## Importing existing academic websites

ScholarOS respects the work you have already done.

If you are currently using an established academic template such as **al-folio**, ScholarOS can _import your existing content_ — publications, posts, projects, news, and data — into its own structure.

This is an **opt-in, content-only import**:

- no scraping
- no copying of theme code
- full license and attribution preserved
- your data remains yours

The goal is to reduce switching friction, not to replace or devalue existing projects.

---

## Who ScholarOS is for

- Researchers who want their site to reflect their current work
- Labs that need multiple contributors without chaos
- Academics who want automation without servers
- Groups who value clarity, longevity, and provenance

If your website should behave more like a research instrument than a static page, ScholarOS is designed for you.

---

<p align="center">
  Built with care for the academic community.
  <br>
  If ScholarOS helps you, please consider giving it a <a href="https://github.com/yazdanimehdi/ScholarOS">star</a>.
</p>

---

## Table of Contents

- [Getting Started](#getting-started)
  - [The quick way (no local setup needed)](#the-quick-way-no-local-setup-needed)
  - [For advanced users: local development](#for-advanced-users-local-development)
- [Features](#features)
  - [Two Modes: Personal & Lab](#two-modes-personal--lab)
  - [Publications](#publications)
  - [Blog & External Feeds](#blog--external-feeds)
  - [People Directory](#people-directory)
  - [CV / Resume](#cv--resume)
  - [Research Areas](#research-areas)
  - [Projects](#projects)
  - [News & Announcements](#news--announcements)
  - [Talks & Presentations](#talks--presentations)
  - [Open Positions](#open-positions)
  - [GitHub Repositories](#github-repositories)
  - [Global Search](#global-search)
  - [Dark Mode](#dark-mode)
  - [Hero Backgrounds](#hero-backgrounds)
  - [Newsletter Signup](#newsletter-signup)
  - [Contact & Application Forms](#contact--application-forms)
  - [Analytics](#analytics)
  - [SEO & Structured Data](#seo--structured-data)
  - [RSS Feed](#rss-feed)
  - [CMS Admin Panel](#cms-admin-panel)
  - [Deploy on Vercel (custom admin)](#deploy-on-vercel-custom-admin)
  - [Cookie Consent (GDPR)](#cookie-consent-gdpr)
  - [Internationalization (i18n)](#internationalization-i18n)
  - [View Transitions](#view-transitions)
- [Configuration](#configuration)
  - [Site Configuration](#site-configuration)
  - [Colors & Typography](#colors--typography)
  - [Navigation](#navigation)
  - [Social Links](#social-links)
  - [Homepage Sections](#homepage-sections)
- [Content Collections](#content-collections)
- [Project Structure](#project-structure)
- [Pages](#pages)
- [Automation Workflows](#automation-workflows)
- [Deployment](#deployment)
- [Migration from al-folio](#migration-from-al-folio)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Getting Started

### One-click deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyazdanimehdi%2FScholarOS&project-name=scholaros&repository-name=scholaros&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%2C%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D&env=SESSION_SECRET%2CCRON_SECRET%2CADMIN_PASSWORD&envDescription=SESSION_SECRET%20and%20CRON_SECRET%3A%20any%20random%20text%20of%2032%2B%20characters%20each%20%28they%20are%20never%20typed%20again%29.%20ADMIN_PASSWORD%3A%20the%20password%20you%20will%20sign%20in%20with%20%2812%2B%20characters%29%3B%20your%20username%20is%20your%20GitHub%20username.&envLink=https%3A%2F%2Fgithub.com%2Fyazdanimehdi%2FScholarOS%23one-click-deploy-on-vercel)

The button copies ScholarOS into your GitHub account, creates a Vercel project with a Neon Postgres database and a
public Vercel Blob store, and asks for three values:

| Variable         | What to enter                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET` | any random text of 32+ characters (`openssl rand -base64 48`, or a password manager's generator) |
| `CRON_SECRET`    | another random text of 32+ characters                                                            |
| `ADMIN_PASSWORD` | the password you will sign in with (12+ characters)                                              |

The first build sets everything up: it creates the tables, copies the example content into the database, uploads its
images to Blob and creates your admin account. Sign in at `https://<your-project>.vercel.app/admin/login` with your
GitHub username (lowercase) and `ADMIN_PASSWORD`, then make the site yours from the admin. Edits go live on the next
page load, with no rebuild ([Postgres mode](#postgres-mode-live-edits-no-rebuilds)).

Afterwards: change your password under **Users** (the account is created only once, so `ADMIN_PASSWORD` is never
used again and you can delete it), and add a `GITHUB_TOKEN` if you want the daily backup to git
([step 3 of Deploy on Vercel](#deploy-on-vercel-custom-admin)). Set `ADMIN_USERNAME` before the first deploy to pick
a different username.

### The quick way (no local setup needed)

1. Click the **"Use this template"** button at the top of the repository
2. Name your repository **`YOUR_USERNAME.github.io`** (this enables GitHub Pages automatically at `https://YOUR_USERNAME.github.io`)
3. Wait about a minute -- GitHub Actions will build and deploy your site
4. A **setup issue** is automatically created in your new repository with a checklist to guide your initial configuration
5. Go to `https://YOUR_USERNAME.github.io/admin` to open the CMS and start customizing -- change your name, photo, bio, publications, and everything else through the browser

That's it. No terminal, no local install, no code editing. The CMS handles content, and GitHub Actions handles deployment.

> **Tip:** If you don't want a `username.github.io` site, you can name the repo anything (e.g., `my-lab-site`). Your site will be available at `https://YOUR_USERNAME.github.io/my-lab-site/`. Just make sure to go to **Settings > Pages > Source** and select **GitHub Actions**.

### For advanced users: local development

If you prefer working locally, want to customize components, or need to run automation scripts:

#### Prerequisites

- [Node.js 22.22+](https://nodejs.org/)
- [pnpm](https://pnpm.io/)

#### Setup

```bash
# Clone your repository (after using the template above, or fork directly)
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Install dependencies
pnpm install

# Start development server with hot-reload
pnpm dev
```

Your site will be running at `http://localhost:4321`.

#### Where to edit what

| What you want to change               | Where to edit                                    |
| ------------------------------------- | ------------------------------------------------ |
| Site name, mode, description, socials | `config/site.yml`                                |
| Colors, fonts, hero background        | `config/site.yml` (colors, fonts, hero sections) |
| Research areas                        | `config/research.yml`                            |
| CV / resume                           | `config/cv.yml`                                  |
| Publications                          | `src/content/publications/*.md`                  |
| Blog posts                            | `src/content/posts/*.md`                         |
| Team members                          | `src/content/people/*.md`                        |
| News / announcements                  | `src/content/announcements/*.md`                 |
| Projects                              | `src/content/projects/*.md`                      |
| Open positions                        | `src/content/positions/*.md`                     |
| Talks                                 | `src/content/talks/*.md`                         |
| External RSS feeds                    | `config/feeds.yml`                               |
| Navigation menu                       | `config/site.yml` (nav section)                  |
| Page layouts & components             | `src/layouts/` and `src/components/`             |

#### Build commands

```bash
pnpm dev              # Start development server
pnpm build            # Build for production
pnpm preview          # Preview production build locally
pnpm sync:feeds       # Sync external RSS feeds
pnpm sync:scholar     # Sync Google Scholar publications
pnpm render:cv        # Generate CV PDF
pnpm generate:keywords # Generate SEO keywords from content
pnpm migrate:al-folio # Import content from an al-folio site
```

---

## Features

### Two Modes: Personal & Lab

ScholarOS adapts its language, layout, and navigation based on a single config flag:

```yaml
# config/site.yml
siteMode: 'personal' # or "lab"
```

|                | Personal Mode     | Lab Mode                              |
| -------------- | ----------------- | ------------------------------------- |
| Homepage hero  | Your name & title | Lab name & mission                    |
| Publications   | "My publications" | "Our publications"                    |
| People page    | Hidden or minimal | Full team directory with roles        |
| Positions page | "Work with me"    | "Join our lab" with application forms |
| About section  | Personal bio      | Lab overview                          |

### Publications

A dedicated publications page with advanced filtering:

- **Filter by type** -- journal, conference, preprint, workshop, thesis, book chapter
- **Filter by year** -- dropdown year selector
- **Keyword search** -- real-time search across titles, authors, venues
- **Author highlighting** -- your name is automatically bolded
- **One-click BibTeX copy** -- copy citation to clipboard
- **PDF & DOI links** -- direct links to papers
- **List & Grid views** -- toggle between compact and card layouts
- **Thumbnail images** -- optional paper thumbnails with automatic optimization

### Blog & External Feeds

Full-featured blog with support for external content aggregation:

- **Markdown & MDX** -- write posts in Markdown with optional JSX components
- **LaTeX math** -- native support via remark-math and MathJax
- **Code highlighting** -- GitHub-themed syntax highlighting (light & dark)
- **Tags** -- categorize posts with filterable tags
- **Draft support** -- mark posts as drafts to exclude from production
- **External feeds** -- aggregate content from Medium, Substack, or any RSS source
- **RSS output** -- `/feed.xml` endpoint for subscribers

### People Directory

Showcase your team with rich profile cards:

- **Role-based grouping** -- PI, Postdoc, PhD, Masters, Undergrad, Research Assistant, Visiting, Alumni
- **Profile photos** -- with configurable shapes (rectangular, circular, oval)
- **Social links** -- GitHub, Google Scholar, Twitter/X, LinkedIn, ORCID, Mastodon, Bluesky
- **Research interests** -- displayed as tags on each profile
- **Individual profile pages** -- dedicated page per team member with full bio
- **Email obfuscation** -- spam-protected email display

### CV / Resume

A structured CV page driven entirely by YAML:

```yaml
# config/cv.yml
cv:
  name: 'Prof. Jane Smith'
  sections:
    education:
      - institution: 'MIT'
        degree: 'Ph.D.'
        area: 'Computer Science'
    experience:
      - company: 'Stanford University'
        position: 'Associate Professor'
    publications:
      - title: 'Your Paper Title'
        journal: 'NeurIPS 2025'
    awards:
      - label: 'Best Paper Award, ACL 2023'
    skills:
      - label: 'Languages'
        details: 'Python, TypeScript, C++'
```

- **PDF generation** -- RenderCV renders the PDF in every mode (GitHub Actions, or the admin on Vercel)
- **Styles** -- nine built-in themes, three densities and your own themes (see [CV styles](#cv-styles))
- **Download button** -- visitors can download your CV as PDF

Any CV text can carry inline formatting: `**bold**`, `*italic*`, `[a link](https://…)` (or `mailto:`), and a font
for part of a line with `[text]{.serif}`, `[text]{.sans}` or `[text]{.mono}`. Write `\*` for a literal asterisk, as in
`'**Jane Smith**\*'` for equal contribution. In the admin's CV editor, select text in an entry field and use the
formatting bar (B, I, Link, Font) or Cmd/Ctrl+B, I and K; the preview below the fields shows the result. The site
renders all of it; the PDF renders bold, italic and links. Font spans are website-only: RenderCV has no fonts to
switch to, so they print as plain text in the PDF.

### Research Areas

A dedicated research overview page configured via YAML:

```yaml
# config/research.yml
areas:
  - title: 'Natural Language Processing'
    description: 'Developing models that understand and generate human language...'
    tags: ['Language Models', 'Multilingual NLP', 'Text Generation']
```

Automatically displays related active projects and featured publications for each area.

### Projects

Showcase research projects, software tools, and datasets:

- **Type categories** -- software, dataset, benchmark, hardware, other
- **Status indicators** -- active, completed, upcoming
- **Links** -- repository URL, paper URL, live demo
- **Team members** -- link to people profiles
- **Tags** -- filterable project tags

### News & Announcements

Keep visitors updated with a news feed:

- **Categories** -- paper, grant, award, talk, media, general
- **Pinned items** -- pin important announcements to the top
- **Emoji indicators** -- visual emoji badges for quick scanning
- **Category filtering** -- browse news by category
- **Homepage widget** -- latest announcements on the homepage

### Talks & Presentations

A dedicated page for conference talks, invited lectures, and seminars:

- **Talk types** -- Conference Talk, Invited Talk, Seminar, Tutorial, Workshop, Keynote, Panel
- **Slides & video links** -- direct links to presentation materials
- **Event & location** -- where and when you presented

### Open Positions

Recruit new team members with dedicated position listings:

- **Position types** -- PhD, Postdoc, Masters, Undergrad, Research Assistant, Visiting
- **Status tracking** -- open / closed with deadline display
- **Application form** -- built-in application form (via Web3Forms)
- **Detail pages** -- full description with requirements and benefits

### GitHub Repositories

Showcase your lab's open-source work:

- **At a glance** -- total stars, forks, repositories, followers and the year you joined (`trophies: true`)
- **Pinned repos** -- your chosen repositories with description, language, stars, forks, topics and last update
- **Languages and recent activity** -- the main language of each repository, and the five last pushed (`stats: true`)
- **Team activity** -- show GitHub profiles of all team members
- **Self-hosted support** -- use your own github-readme-stats instance for the team cards

The journal theme reads these from a snapshot, `src/data/github.json`: the daily job refreshes it in Postgres mode
(or **Run daily jobs** on the admin Dashboard), and `pnpm sync:github` writes it otherwise. Until the first snapshot,
the page shows the github-readme-stats cards. `GITHUB_TOKEN`, when set, raises GitHub's API rate limit.

### Global Search

Full-site search accessible from any page:

- **Keyboard shortcut** -- `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux)
- **Instant results** -- real-time filtering as you type
- **Cross-content** -- searches across blog posts, publications, people, projects, news, positions, and talks
- **Mobile-friendly** -- dedicated search button on mobile

### Dark Mode

First-class dark mode support:

- **System-aware** -- respects `prefers-color-scheme` by default
- **Manual toggle** -- sun/moon toggle in the header
- **Persistent** -- remembers your choice via localStorage
- **Configurable default** -- set `light`, `dark`, or `system` as the default
- **No flash** -- inline script applies theme before first paint

### Hero Backgrounds

Five hero background options for the homepage:

| Type        | Description                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `image`     | Static image with light/dark variants                                     |
| `video`     | Background video with poster fallback                                     |
| `pattern`   | 17 SVG patterns in any color or gradient (below)                          |
| `animation` | GSAP-powered: particles, gradient-morph, geometric, wave-lines, or custom |
| `none`      | Clean, minimal solid color                                                |

```yaml
hero:
  type: 'animation'
  animation:
    preset: 'wave-lines' # particles | gradient-morph | geometric | wave-lines | custom
```

Patterns: grid, dots, diagonal, waves, hexagons, crosses, triangles, zigzag, rings, scales, topography, helix,
circuit, molecules, cubes, stipple and sparkles. Set them in the admin (Settings → Hero) or in `site.yml`:

```yaml
hero:
  type: 'pattern'
  pattern:
    name: 'circuit'
    color: 'accent' # empty: the brand gradient, or the text color; 'accent' / 'secondary'; or any CSS color
    color2: '#14b8a6' # optional: a second color runs the lines in a gradient
    angle: 135 # the gradient's direction in degrees
    strength: 'medium' # subtle | medium | strong
    fade: true # false: full strength across the hero instead of fading toward the text
    interactive: true # the pattern lights up around the cursor (mouse and trackpad; touch keeps it still)
```

Empty and `accent` follow light and dark mode; a fixed color stays the same in both, so a saturated one usually wants
`strength: 'strong'` to show on a dark background.

### Newsletter Signup

Built-in email capture in the footer:

- **Web3Forms integration** -- free, no-backend email collection
- **Customizable copy** -- set heading and description text
- **Success/error feedback** -- real-time form validation

### Contact & Application Forms

Ready-to-use forms powered by Web3Forms:

- **Contact form** -- name, email, subject, message
- **Application form** -- for position applicants on position detail pages
- **No backend needed** -- emails delivered via Web3Forms API
- **Spam protection** -- built-in honeypot and validation

### Analytics

Plug in your preferred analytics provider (all opt-in):

| Provider               | Config Key         |
| ---------------------- | ------------------ |
| Google Analytics (GA4) | `googleAnalytics`  |
| Google Tag Manager     | `googleTagManager` |
| Cronitor RUM           | `cronitor`         |
| OpenPanel              | `openpanel`        |
| Pirsch                 | `pirsch`           |
| Microsoft Clarity      | `microsoftClarity` |

All analytics scripts are blocked until cookie consent is given (when GDPR banner is enabled).

### SEO & Structured Data

Comprehensive search engine optimization:

- **JSON-LD structured data** -- Person, ResearchOrganization, BlogPosting, ScholarlyArticle, BreadcrumbList
- **OpenGraph & Twitter cards** -- rich previews when sharing links
- **Automatic sitemap** -- generated at `/sitemap-index.xml`
- **Configurable meta tags** -- keywords, Google/Bing verification codes
- **Automated keyword generation** -- GitHub Actions workflow analyzes your content and generates optimized keywords

### RSS Feed

Auto-generated RSS 2.0 feed at `/feed.xml` with `<link>` auto-discovery in the page head. Includes all published blog posts (excludes drafts).

### CMS Admin Panel

Built-in content management system at `/admin`:

- **Visual editor** -- edit content without touching code
- **Collection management** -- full CRUD for all content types
- **Media uploads** -- image and file management
- **Access control** -- configurable admin user list

### Deploy on Vercel (custom admin)

On Vercel, ScholarOS replaces Sveltia with its own admin at `/<adminPath>` (default `/admin`). It has a dashboard, a post editor with math, a three-column CV editor with RenderCV import, and forms for every other kind of content. The dashboard opens with one line saying how the site is doing: the first problem by name ("Scholar sync failed and 2 more need attention"), "Nothing broken · 1 suggestion", or "Everything is up to date". Then comes **Site status**: one row each for publications, the CV PDF, feeds, scheduled posts, news, people and, in Postgres mode, the backup (and, for the owner, the job search: how many applications wait for approval), with the fix on the row itself (**Retry**, **Sync all feeds**, **Regenerate PDF**, **Check now**). A failure says what went wrong in plain words and offers the action that fits: a link to the settings for a missing or refused key, nothing for a rate limit (the next daily run tries again), and **Retry** for a network error. In Postgres mode, **Run daily jobs** is the one control that runs the jobs: it releases due posts, syncs feeds, checks Google Scholar and backs up to GitHub, which they also do on their own once a day. News with no new item in 183 days is a suggestion, not a problem, and People says how many profiles weren't edited in over a year. **Next up** lists scheduled posts, soonest first, then drafts. Every publish is one commit to your repository; Vercel redeploys and the change is live in about a minute. Public pages stay static, and GitHub Pages and Netlify keep using Sveltia.

The sidebar groups the screens by how often you use them: **Content** (Blog posts, News, Publications, CV, People, and a disclosure for Projects, Talks and Positions), **Career** (Job search, for the owner in Postgres mode, with a count of applications waiting for approval), **Site** (Pages, Media, Site editor) and **Setup** (Settings, Integrations, and Users in Postgres mode). **Integrations** replaces the old Scholar & AI screen; its URL is still `ai`. CV styles are a tab on the CV screen (**Entries**, **Styles**). **Jump to…** at the top of the sidebar, or ⌘K (Ctrl+K on Windows and Linux), filters every screen and the create actions by name. Long settings screens (Settings, Integrations, Job search settings) show one section at a time, named in the URL. The page header stays in reach as you scroll and says **Unsaved changes** while an open document has edits you haven't saved.

If your site already runs on Vercel, set the environment variables below before its next redeploy: from then on the custom admin replaces Sveltia at `/<adminPath>`, and without them nobody can sign in.

1. **Import the repository in Vercel** (New Project → your repository). No build settings are needed.
2. **Create a GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps → New OAuth App).
   - Homepage URL: `https://<your-domain>`
   - Authorization callback URL: `https://<your-domain>/api/admin/auth/callback`
   - Keep the client ID, and generate a client secret.
3. **Create a fine-grained personal access token** (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens).
   - Repository access: only this repository.
   - Permissions: **Contents: Read and write**, and **Actions: Read and write** (needed for "Generate PDF").
4. **Set the environment variables** in Vercel (Project → Settings → Environment Variables):

   | Variable               | Value                                                                            |
   | ---------------------- | -------------------------------------------------------------------------------- |
   | `GITHUB_CLIENT_ID`     | OAuth App client ID                                                              |
   | `GITHUB_CLIENT_SECRET` | OAuth App client secret                                                          |
   | `GITHUB_TOKEN`         | the fine-grained token                                                           |
   | `SESSION_SECRET`       | at least 32 random characters (`openssl rand -base64 48`)                        |
   | `GITHUB_REPO`          | optional: `owner/name` (defaults to the repository Vercel deploys)               |
   | `GITHUB_BRANCH`        | optional: the branch to commit to (defaults to the deployed branch, then `main`) |

5. **Add your GitHub username to `adminUsers`** in `config/site.yml`, commit, and let Vercel redeploy.

Sign in at `https://<your-domain>/<adminPath>`. Only `adminUsers` can sign in, and the token never leaves the server. `.env.example` lists the same variables.

To try the admin locally without GitHub, run `VERCEL=1 ADMIN_STORE=memory SESSION_SECRET=<32+ characters> pnpm dev` and open `http://localhost:4321/api/admin/auth/dev`. Edits stay in memory and are never written to disk.

### Postgres mode (live edits, no rebuilds)

With a Postgres database on Vercel, content lives in the database instead of git: a published edit shows on the
next page load, images go to Vercel Blob, and pages are cached on Vercel's CDN and refreshed precisely when you
publish. Git stays a safety net: every save keeps a revision (History in the admin) and a daily job commits all
content to the `content-backup` branch.

1. In the Vercel project: **Storage → Marketplace → Neon** (sets `DATABASE_URL`) and **Storage → Blob**
   (sets `BLOB_READ_WRITE_TOKEN`). Add `CRON_SECRET` (`openssl rand -base64 48`). Vercel Cron calls
   `/api/admin/cron/daily` at 03:00 UTC: it syncs feeds, releases scheduled posts and backs up to git; the dashboard's
   Site status shows each result and has **Run daily jobs**. Keep `GITHUB_TOKEN` for the backup.
   Add `ADMIN_PASSWORD` for your first account (username: `ADMIN_USERNAME`, else the repository owner).
2. Redeploy. Every build on Vercel runs `scripts/vercel-bootstrap.ts` first: it applies new migrations, and on an
   empty database copies `config/`, `src/content/` and `src/data/` into it, uploads `src/assets/images` and
   `public/images` to Blob and rewrites image references to Blob URLs. While no account exists it creates one from
   `ADMIN_PASSWORD`. The build log lists what it did and any file it could not copy. A database that already has
   content is never overwritten; to copy the repo's files again, run `pnpm db:setup --force` locally after
   `vercel env pull .env.local --environment=production` (it overwrites the documents that exist in the repo and
   leaves documents that exist only in the database).
3. The dashboard's Site status now has a **Backup copy** row and **Run daily jobs**.

Notes: MDX posts are shown with a notice (MDX needs a build). The CV PDF is rendered on Vercel (see [CV styles](#cv-styles)).
Editing `adminUsers` takes effect after a redeploy. The feeds, Google Scholar and SEO workflows
(`sync-feeds.yml`, `sync-scholar.yml`, `generate-seo.yml`) commit to git and have no effect on a Postgres-mode site;
the daily job syncs feeds, and **Check now** syncs them at once.

**Back to git mode:** `pnpm db:export` (writes the database's files into the repo; image references stay Blob
URLs), commit, remove `DATABASE_URL` from the project, redeploy.

### Admin accounts (Postgres mode)

In Postgres mode you can sign in with a username and password instead of GitHub (GitHub sign-in keeps working when
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are set).

1. Apply the migration once: `DATABASE_URL='<production connection string>' pnpm db:migrate` (a `DATABASE_URL`
   in the shell overrides `.env.local`, which holds the preview pull from local development below).
2. Create the first account: `DATABASE_URL='<production connection string>' pnpm admin:create-user <username> --production`
   (asks for a display name and a password of at least 12 characters; you confirm by typing the username again).
3. Sign in at `https://<your-domain>/<adminPath>/login`.

The **Users** screen adds accounts, resets passwords and deletes accounts; everyone can change their own password
there. Resetting or changing a password signs that account out on its other devices. After 10 failed sign-ins for a
username within 15 minutes, that username is refused until the window passes.

### Local development against Neon

1. In the Neon console, create a branch named `dev` from `main` (a copy of your live content).
2. `vercel link`, then `vercel env pull .env.local --environment=preview`.
3. Add `DEV_DATABASE_URL=<the dev branch's connection string>` to `.env.local`.
4. `pnpm admin:create-user <username>` (on the dev branch), then `pnpm dev:postgres`.

`pnpm dev:postgres` runs the site in Postgres mode against the dev branch only: it never uses the `DATABASE_URL`
from `.env.local` (production). Uploads (images, the CV PDF) go to the shared Blob store; deletes are skipped
locally so the live site's files are never removed.

### Scheduled posts

A post whose date is in the future is _scheduled_: the editor's button reads **Schedule**, the admin lists it as
`Scheduled · <date>`, and the site hides it (lists, tag pages, RSS, sitemap, search; its URL is a 404) until that date.
Precision is one day.

- **Postgres mode:** the daily job (03:00 UTC) refreshes the cached pages.
- **Git mode on Vercel:** `.github/workflows/release-scheduled.yml` runs daily at 06:00 UTC and, when a post became
  due, calls a deploy hook. Create one (Vercel → Project → Settings → Git → Deploy Hooks) and save its URL as the
  repository secret `VERCEL_DEPLOY_HOOK_URL`. Without it the workflow only logs a notice. GitHub sometimes skips
  scheduled workflow runs; if a scheduled post didn't appear, run "Release scheduled posts" manually from the
  Actions tab (`workflow_dispatch`).
- **GitHub Pages:** `deploy.yml` checks daily at 06:00 UTC and rebuilds only when a post became due.

### Cross-posting to Medium

Tick **Also publish to Medium** before publishing a post.

- With `MEDIUM_TOKEN` set (an existing Medium integration token; Medium no longer issues new ones), the post is
  sent as a Medium **draft** with its canonical link pointing at your site; the Medium link is saved in the post.
- Without a token, **Import to Medium** copies the post's URL and opens Medium's import tool, which sets the
  canonical link itself. Paste the resulting Medium link into **Medium URL**.

A post is sent once; afterwards the editor shows **Already on Medium**. When your Medium feed later brings the same
story in, the Writing page shows only the site's copy.

### AI assist

The admin can draft and rewrite post and news bodies, generate cover images and publication figures, and turn new
Google Scholar papers into draft posts, using your own provider keys.

- **Keys.** Open **Integrations** in the admin. In Postgres mode, paste a key and **Save**: it is stored encrypted in
  the database (with a key derived from `SESSION_SECRET`; changing that secret means entering the keys again). In git
  mode, set them as environment variables in Vercel; the Integrations screen shows which are set. An environment
  variable is the fallback in both modes. Keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
  `HIGGSFIELD_API_KEY` + `HIGGSFIELD_API_SECRET`, `SERPAPI_KEY`.
- **Models.** Writing uses Anthropic, OpenAI or Google; images use OpenAI, Google or Higgsfield. Pick them on the
  Integrations screen (saved to `config/ai.yml`); an empty model uses the current default (`claude-sonnet-5-5`,
  `gpt-6-astra`, `gemini-3.8-flash`; `gpt-image-2.5-flare`, `gemini-3.1-flash-image`, `higgsfield-ai/soul/standard`).
- **What is sent.** **Write** and **Rewrite** send the title, subtitle, your instruction and the body to the writing
  provider. **Generate image** sends the title and summary to the image provider. Paper posts send the paper's
  title, authors, venue, year, link and abstract. Results land in the editor as unsaved changes (with **Undo**);
  nothing is published until you save.
- **Publication figures and GIFs.** In the publication editor, **Generate image** draws a journal-style figure from
  the title and abstract. **Generate GIF** (posts, news and publications) asks Higgsfield for a still, animates it
  with Higgsfield image-to-video, and saves a looping animated WebP. It needs the Higgsfield keys whichever image
  provider is chosen, and takes one to three minutes. Its **Animation model** setting on the Integrations screen
  defaults to `bytedance/seedance-2.5/image-to-video`.
- **Paper drafts.** Add the Scholar author id (the `user=` value of the profile URL) on the Integrations screen. Both
  modes check Scholar every day by default; **Check for new papers** on the same screen (`papers.schedule` in
  `config/ai.yml`) picks every day, a weekday each week, a day each month (UTC), or never. **Check now** works in both
  modes, whatever the schedule. New papers become publications and, unless turned off, **draft** posts with a cover
  image, linked to the publication. The first check only records the papers already on the profile (no posts), so
  turning this on doesn't write a post for every old paper. Each check writes at most **Posts per run** posts (default
  three); the rest wait for the next one. A publication you delete is not imported again.
- **Completing papers.** A paper that arrives from Scholar has little more than a title, so new ones are completed
  automatically (up to 10 per run; the rest wait for the **Complete papers** button) from arXiv (via DataCite), bioRxiv/medRxiv,
  Crossref/DOI, PubMed and OpenAlex: the abstract, DOI, authors, venue, year, type, links, PDF and BibTeX they can
  confirm. **Complete papers** on the Publications screen reviews the same for papers you already have: empty fields
  are ticked, replacements of a value you have are unticked, each value shows its source, and a change you decline is
  not offered again. The sources are free and need no key, and their rate limits are respected. Your own fields are
  never touched: nothing is replaced unless you tick it.
- **Upload PDF.** Next to a paper's PDF field, **Upload PDF** stores the file with the site's media (4 MB max) and
  fills in its link; uploaded PDFs aren't listed on the Media screen.
- **Git mode.** The Scholar GitHub Action (`sync-scholar.yml`) runs daily and follows `papers.schedule`, so a git-mode
  site now checks Scholar every day by default (it used to be weekly). It only adds new papers and fills empty
  fields; it no longer overwrites a title, authors, venue or year you already have.
- **Cost.** Each paper post is one writing call and one image call on your provider accounts. Scholar is read
  through [SerpApi](https://serpapi.com/google-scholar-author-api): one search per author per check plus one per
  paper post. The free tier (about 250 searches a month) covers one author daily plus a few new papers.

### Site editor

**Site editor** in the admin changes the site's code from a plain-language request ("make the header serif and move
the news section above publications"). A coding agent edits a private copy of the site in a
[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox), you check the result in a live preview, and **Publish**
commits it so the site redeploys.

- **Requirements.** The admin on Vercel (git or Postgres mode), `GITHUB_TOKEN` with Contents: read and write (the
  token git mode and the backup already use), and a key for the writing provider chosen on the Integrations screen.
  The agent is that provider's own coding tool: Claude Code for Anthropic, Codex for OpenAI, Gemini CLI for Google,
  with the writing model from the Integrations screen. On Vercel the sandbox signs in automatically (OIDC). For local
  development, run `vercel link` and `vercel env pull` to get `VERCEL_OIDC_TOKEN`.
- **How it works.** **Start** creates one sandbox for the site (about a minute the first time: clone and install).
  Describe a change and **Run**; the agent's log shows while it works, and the preview reloads when it is done.
  **Stop** ends the agent and everything it started; what it changed so far stays. Ask for more, **Discard** to go
  back, or **Publish**: one commit on the deployed branch with your message. In Postgres mode, code is committed to
  GitHub and content edits (posts, `config/*.yml`) are saved to the database. **Pause** stops the sandbox and keeps
  its files; **Resume** picks up where you left off, unpublished changes included. **Start over** deletes it and
  starts from a fresh copy of the live site, which is also the way out when the site changed on GitHub since the
  session started (Publish then refuses with a 409).
- **After Publish.** The screen polls `GET /api/admin/editor/deployment`, which returns the deployment's
  `VERCEL_GIT_COMMIT_SHA`, and says the live site is updated once that matches the published commit. Off Vercel, on
  a preview URL or behind Skew Protection the commit never changes, so the screen keeps "about a minute".
  **Undo this publish** reverts the last publish from this screen with a new commit on GitHub. It is refused when a
  later commit touched the same files, and it isn't offered for a Postgres-mode publish that saved content to the
  database; in those cases, ask for the change back and publish again.
- **Scope.** The editor publishes only site code and content: components, layouts, pages (`.astro`, `.md`, `.mdx`;
  never endpoints or anything named `api`), styles, themes, assets, content files, `src/data/*.json`, `public/` and
  `config/*.yml`. The admin, sign-in, `src/lib`, middleware, integrations, `config/ai.yml`, dependencies, build and
  deploy config, dot-files and secrets are refused: the screen shows refused files in red and Publish stays
  disabled until you undo them (**Undo this file** reverts one file and keeps the rest) or discard. The review lists
  each request with the agent's plain-language **What changed** summary, above the diff. `.astro` files can still
  run server code when they load; if you're unsure, share the preview link with someone technical before publishing.
- **Keys stay out of the sandbox.** The provider key never enters the sandbox: the agent sees a placeholder and the
  sandbox firewall adds the real key to requests to the provider's API only. The GitHub token enters a sandbox once,
  for the first clone, before any agent has run in it, and GitHub is closed to the sandbox from then on; publishing
  happens from the admin, not from the sandbox.
- **Cost.** Sandbox time is billed to your Vercel account; a session times out after 30 minutes without a run (each
  run extends it) and Hobby sessions end at 45 minutes (the files persist; **Resume** picks up). Each run is
  billed by your provider like any use of its coding tool. One session per site: every admin shares it, and a second
  **Run** while one is active is refused.
- **Publishers.** `publishers` in `config/site.yml` lists who may **Publish** and **Undo this publish**: GitHub
  usernames as in `adminUsers`, or `password:<username>` for a password account (Postgres mode), so a password account
  never passes for the GitHub user of the same name. Empty or unset, every admin publishes. Other admins can Start,
  Run, Stop, Discard and ask for more; their changes wait in the shared session, the review says who asked for each,
  and the publish routes answer 403. Publishers see "Site changes waiting for review" on the Dashboard's Next up,
  read from a tag on the sandbox (one lookup that never wakes it), so it shows while the session is paused too.

### CV styles

RenderCV renders the CV PDF everywhere: on GitHub Actions in git mode and on static hosting, and on Vercel (both
admin modes) in a private Python service deployed beside Astro. A style is a RenderCV theme (`classic`, `sb2nov`,
`engineeringresumes`, `moderncv`, `engineeringclassic`, `harvard`, `ink`, `opal` or `ember`), a density (`compact`,
`normal` or `airy`) and optional `design` overrides in RenderCV's own keys. Styles live in `config/cv-styles.yml`, and
`public` names the one used for the public PDF. Without the file you get one style built from your `cv.yml`: "My
style" at `normal` density when its `design` has overrides beyond the theme, otherwise a compact style in its theme.

```yaml
# config/cv-styles.yml
public: compact
styles:
  - id: compact
    name: Compact
    theme: classic
    density: compact
    design: {}
```

On Vercel, **CV → Styles** in the admin edits the list with a live preview; the preview and **Generate PDF** render
through the service. A design RenderCV rejects (a bad margin, say) shows its error and leaves the public PDF alone. A
raw YAML upload that carries its own `design` keeps it. When the GitHub Action folds such an upload into `cv.yml` and
disables it, it also saves that design as the public style "Uploaded design" (`uploaded-design`) in
`config/cv-styles.yml`, creating the file if needed. On Sveltia the same file is under **CV (Styles)**, without
the preview.

Custom themes are RenderCV theme folders under `cv/themes/<name>/` (`*.j2.typ` and `*.typ` files, names `a-z0-9`, at
most 40 files and 512 KB). Upload them in **CV → Styles**; only publishers can upload or delete a theme, because a
theme template is code that runs in the renderer. Per-person lab CVs (`cv/*.yml`) keep their own `design` and are
rendered on GitHub Actions only.

To render locally run `pip install -r scripts/requirements.txt`. `astro dev` previews through
`services/cv-render/cli.py` and needs `pip install -r services/cv-render/requirements.txt`. The paper size is
`pdf.pageSize` in `cv.yml`, used for the default style when there is no `cv-styles.yml` (otherwise set `design.page.size`):

```yaml
# config/cv.yml
pdf:
  pageSize: A4 # or LETTER (default)
```

### Job search (Postgres mode)

A private job search inside the admin. Each night it gathers postings from the sources you turn on, scores them against your CV and preferences, and lists the best matches. On a posting, **Draft CV and letter** (later **Regenerate both**) writes a tailored CV (rendered to PDF in one of your [CV styles](#cv-styles)), a cover letter and, for Greenhouse forms, proposed answers. **Pre-fill the application** then fills in the real form and stops before Submit. Nothing is sent until you approve it.

**Owner only, Postgres mode only.** Only the owner sees the screens, the data and the source keys. The owner is the `owner` entry in `config/site.yml`; when that is empty, it is the first `adminUsers` entry. An entry is a GitHub login or `password:<username>`, matched like `publishers`. Anyone else gets a 404, so they cannot tell the feature exists. In static and git mode every job-search screen and route answers 404 and the nav link is hidden (CV styles keep working in all modes).

**Sources.** Turn them on under **Job search → Settings → Sources**. A source that needs a key you have not saved reports `skipped: no <KEY>`; that is not a failure. Keys live in the `secrets` table, never in content or the git backup.

| Source                                 | Key                                   | On by default | Notes                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watched companies (`watched`)          | none                                  | yes           | Greenhouse, Lever, Ashby, Workable and SmartRecruiters boards from your watched list. Every open role is kept, not only those matching your roles or keywords                                                         |
| Company careers pages (`careers-page`) | none                                  | yes           | Watched URLs that are not a known board. Up to one AI call per URL on every run, to read the page                                                                                                                     |
| Remotive (`remotive`)                  | none                                  | yes           |                                                                                                                                                                                                                       |
| Remote OK (`remoteok`)                 | none                                  | yes           |                                                                                                                                                                                                                       |
| Arbeitnow (`arbeitnow`)                | none                                  | yes           |                                                                                                                                                                                                                       |
| Google Jobs (`google-jobs`)            | `SERPAPI_KEY`                         | yes           | Up to 6 SerpAPI credits a run (2 pages × up to 3 locations), from the same `SERPAPI_KEY` as the Scholar sync. Nightly that is about 180 a month, enough to use up a free plan the papers sync also needs              |
| RSS feeds (`rss`)                      | none                                  | yes           | Feeds you add, every item kept (not filtered by your roles or keywords). `SUGGESTED_FEEDS` currently lists only the two HigherEdJobs feeds that were confirmed (Chemistry; Geology, Earth Sciences, and Oceanography) |
| Adzuna (`adzuna`)                      | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`     | no            |                                                                                                                                                                                                                       |
| USAJobs (`usajobs`)                    | `USAJOBS_API_KEY`                     | no            |                                                                                                                                                                                                                       |
| LinkedIn guest search (`linkedin`)     | none (`SERPAPI_KEY` for the fallback) | no            | See the note below. The fallback uses up to 3 SerpAPI credits a run (1 page × up to 3 locations)                                                                                                                      |

**LinkedIn.** LinkedIn's terms forbid automated access and its `robots.txt` disallows everything, so this is the one source that does not check `robots.txt`; turning it on is your call, for personal use. It reads only the public guest search (2 pages per location, the honest ScholarOS User-Agent, no cookies), never your account, and stops at the first refusal. LinkedIn often blocks server IPs like Vercel's; when it refuses or finds nothing and `SERPAPI_KEY` is set, the source falls back to the Google Jobs results LinkedIn lists. Guest-search postings carry no description, so they are scored on title, company and location.

**The nightly run.** The daily cron (03:00 UTC) starts it once preferences have a role, keyword, watched company or feed, and it goes as far as the stage you choose (see [How far the night goes](#how-far-the-night-goes)); **Run now** starts it any time, and a run that is still going is not started twice. It is a [Vercel Workflow](https://vercel.com/docs/workflows), so each run shows in the Workflow dashboard. It gathers every enabled source in parallel, fetches the detail of new postings that came without a description (at most 30 per source), then scores the new postings five at a time. Each run scores at most `maxScoresPerRun` postings (default 100), and each **Run now** is a run of its own; the rest wait for the next run and are counted as `deferred`. Scoring a posting takes one AI call, and up to three when the model's reply is not the JSON asked for. Company careers pages add up to one AI call per watched URL on every run, and that list has no cap. A provider or network error also leaves a posting deferred. A reply the model cannot get right after three tries marks that posting `failed`. If the AI key or the CV is missing, nothing is scored and the run says why (`scoreSkipped`). Posting text is untrusted: it is guarded before any AI call or storage, wrapped as data in every prompt, never rendered as HTML, and capped at 20,000 characters.

**Drafts do not fabricate.** The AI may only select, reorder, condense and reword what is in your CV and Application answers. The tailored CV is assembled from that CV by `assembleCv`, so a claim that is not in it cannot enter, and a second AI pass (the reviewer) checks the result against the CV. If the reviewer finds issues, the draft is revised once; one that still has issues is saved as `needs-review` with the issues listed. A draft makes at most 6 AI calls (7 with Greenhouse answers). Form answers come from your CV and Application answers; EEO questions follow your setting and decline by default; a fact that is not there is left empty as a hand-off for you to fill in, never guessed. Answers are proposals only.

**Suggested settings.** When preferences have no roles, keywords, fields, watched companies or feeds, **Job search → Settings** fills its empty fields from your site: one AI call reads the CV and up to 40 papers from the publications collection (title, topic and the first 200 characters of the abstract) and suggests roles, keywords, seniority, fields and languages, at most 8 of each. Locations are only ever the CV's own contact location, copied in code and filled in only when Locations is empty, since a posting outside your locations that isn't remote is filtered out (the AI isn't asked: past places on the CV would filter out jobs you want). Phone, address and links (your social networks and website) are copied from the CV in code, with no AI, into empty answers only. **Suggest from my site** asks again any time and replaces those five preference lists; it never replaces Locations you have set. Nothing is saved until you press Save; a banner says the form holds suggestions until then.

**The requirements panel.** A drafted CV lists the posting's key requirements, required ones first, and how the tailored CV covers each: shown (in this version), cut (in your CV but not in this version; restore it in the plan editor), worded differently (supported by a named CV entry in other words), or a gap (not in your CV). Whether a term appears in the tailored CV or in your CV is checked in code; whether a missing term is worded differently or a gap rests on the CV entry the model cites as evidence. A term used more than three times is flagged as possible keyword stuffing.

**Papers by relevance.** A draft can choose from every paper in the publications collection, pooled with the CV's own publication section, not only the papers the CV lists. The drafter picks the most relevant to the posting by title and abstract (5 to 8 for a research role, 2 to 4 otherwise). Abstracts are only for judging relevance; they are never quoted in the CV or the letter.

**Where the data lives.** Preferences, Application answers, postings and events are in the Postgres tables `career_settings`, `career_postings` and `career_events` (migration `005_career.sql`; `006_apply.sql` adds each posting's application and the submit queue, `007_apply_lock.sql` the hold that keeps applying to one run at a time), not in `documents`, so they never reach the git backup or the generic config API. The daily jobs record only a neutral `done` for this step. Tailored PDFs, the application's screenshots and the letter PDF go to Vercel Blob under `career/` with a random suffix and no row in the media library. They are public URLs that cannot be guessed, but anyone with the link can open them.

**Previews share production data.** A Vercel preview uses the same database and Blob store as production. Deploying one applies the migration to the live database, and a run on it writes real postings and spends your real AI and SerpAPI credits. Approving an application on a preview submits it to the employer for real.

#### Applying

On a posting with a tailored CV, **Pre-fill the application** opens the posting's application form in a headless browser (Playwright in a [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)), fills every field, uploads the tailored CV and the cover letter as a PDF, takes screenshots and stops before Submit. It takes a minute or two.

1. **Pre-fill.** The values come from your CV and Application answers first. The AI fills only what those don't cover, from the posting, and its values are marked **AI** so you check them. A value nobody is sure of is never guessed: the posting is handed to you instead.
2. **Review.** The job page shows the screenshots and every field with its value and where it came from (CV, Answers, AI, File, or Not filled). Edit any value; an edited one is marked **You**.
3. **Approve.** **Approve and submit** asks once more, naming the form's site and the number of fields. **Skip** and **Finish it myself** are beside it.
4. **Submit.** Until the queue picks it up, **Withdraw approval** puts it back to waiting for your approval. When the queue couldn't start, the approval stands and it goes out with tonight's run at the latest. Within a few minutes the browser opens the form again and fills exactly the values you approved, nothing else. If the form changed since the pre-fill (a new or renamed field, a new required question, different options), it stops before typing anything and asks you to pre-fill again. After Submit it saves a screenshot of the confirmation page and sets the posting to submitted. When the site doesn't confirm it, the posting says so (**Mark as submitted** or **It wasn't sent**); it is never submitted a second time on its own.

A pre-fill or submission moves the posting's status only while it is found, drafted or ready, so a status you set while it ran (Skipped, Interview…) stands.

**Nothing is sent without your approval.** Submitting is never a nightly stage and can't be turned on. **Approve all ready** on the **Ready for approval** tab is a convenience: its confirm lists every posting waiting for approval, and it approves exactly those, each on its own with the pre-fill the list showed. One pre-filled again or no longer waiting by the time you confirm is left as it was, and the message says so.

**Hand-offs.** A captcha, a sign-in or account creation (Workday and similar), a page with no application form, a form that asks more questions once filled, or a value the server isn't confident about stops the pre-fill. The posting then says **Finish this one yourself** with the reason, a link to the form, the tailored CV and letter PDFs, and each prepared value with a **Copy** button.

**One application at a time.** One sandbox runs the browser, and one pre-fill or submission holds it at a time. **Pre-fill** while another is running answers "Another application is being filled in or sent: try again in a few minutes"; approved applications wait in a queue and go out one by one. A hold left by a run that died is released after 15 minutes. The browser is plain code that takes no instructions from the page; the sandbox holds no keys and can't reach private IPv4 addresses (cloud metadata included).

#### How far the night goes

Under **Job search → Settings → Automation**, choose where the nightly run stops. Each stage includes the ones before it.

1. **Search only:** find new postings.
2. **+ Score:** score each new posting.
3. **+ Tailor CV and letter** (the default): draft a CV and cover letter for each match at or above your threshold, best score first.
4. **+ Pre-fill applications for approval:** pre-fill each draft that passed its review cleanly and list it under **Ready for approval**.

Limits under the same section: **Drafts per night** (default 5; the rest wait for the next night), **Applications per company** within **this many days** (default 2 in 30; postings at that company you drafted, sent or moved further in the window count), and **Pause all nightly job search**, which makes every run do nothing of its own. Applications you approved yourself are still submitted while it is paused. **Run now** follows the same settings. When a draft or a pre-fill fails (an exhausted quota, a provider error), the night stops there and the run records why (`stopped`) instead of reporting nothing drafted. **Job search** shows the last run in one line (found, scored, drafted, pre-filled, to finish yourself, held back by limits, or that it was paused), with why it stopped early and a digest that failed to send below it; the dashboard's Job search row also leads with **Stopped early**, and the digest says it too.

The dashboard's Site status, the sidebar's Job search badge and the **Ready for approval** tab always show how many applications wait for you.

#### Email digest

**Job search → Settings → Notifications** can email you a digest after each nightly run: the counts, why the run stopped if it did, what is ready for approval and what was drafted, each linked to its page in the admin. It is off by default. It is sent through [Resend](https://resend.com): create an API key in your Resend account and save it as `RESEND_API_KEY` on **Integrations → Keys**. **To** defaults to the email on your CV. **From** defaults to `ScholarOS <onboarding@resend.dev>`, which Resend only delivers to your Resend account's own email until you verify a domain there. A night with nothing new sends nothing, and a digest that fails is recorded on the run, never failing it.

#### Drafting worker

**Job search → Settings → Drafting worker** picks what writes drafts, their review, form answers and the AI's application values. Scoring always uses the API provider.

- **API keys** (the default): the writing provider and key on **Integrations → Writing & images**.
- **Claude Code**, **Codex** or **Gemini CLI**: the agent CLI answers each call once, in a short-lived Vercel Sandbox.
  - **Claude Code** signs in with your Claude subscription or an Anthropic key. For the subscription, run `claude setup-token` on your computer and save the token it prints as `CLAUDE_CODE_OAUTH_TOKEN` on **Integrations → Keys**. The token never enters the sandbox: the sandbox's firewall adds it to requests to Anthropic's API.
  - **Codex** signs in with your ChatGPT subscription or an OpenAI key. For the subscription, sign in to Codex with ChatGPT on your computer and paste `~/.codex/auth.json` into `CODEX_AUTH_JSON` on **Integrations → Keys**. Codex reads and refreshes that file itself, so the firewall can't add it the way it adds a key: it is copied into the sandbox for each call and deleted when the call ends. The sandbox is kept between calls, so each call first deletes any sign-in a call that died left behind (any at all when the worker isn't Codex on your subscription). That sandbox reaches only OpenAI's hosts and the npm registry, to install Codex. A refreshed file replaces the saved one.
  - **Gemini CLI** stands in for Antigravity, which has no sign-in that works unattended yet. It runs on your `GEMINI_API_KEY`.

When a subscription runs out of quota, the run stops and says so. It never falls back to paid API use. Subscription tokens and keys are sealed in the `secrets` table like every other key, never in content or the git backup. Sandbox time for applying and for the CLI workers is billed to your Vercel account.

#### Checking it on a preview

Do this once, as the owner, after a preview deploys:

1. Sign in on the preview's `/admin`. In the browser console run `const { runId } = await (await fetch('/api/admin/career/run', { method: 'POST' })).json();`, then poll `GET /api/admin/career/run` until the status is `completed`. This confirms Workflow runs on the preview.
2. Save test preferences (one role, a few sources, a low `maxScoresPerRun`), click **Run now**, and wait for `completed`. Note the run id.
3. Open one job and click **Draft CV and letter**. The PDF should render.
4. Find the run in the Vercel Workflow dashboard.
5. Clean up with `delete from career_postings; update career_settings set last_run = null, run_id = null;` in the Neon SQL editor, delete the `career/` files in the Vercel Blob browser (the test run's tailored PDFs, which are public URLs), then clear the test preferences.

### Reading (Postgres mode)

A private paper digest inside the admin. Each night it collects the day's new papers from the sources you turn on, ranks them against your field, adds the papers people in your wider area are talking about, and saves the result under **Reading → Today**. Nothing in it reaches the public site.

**Owner only, Postgres mode only.** The same rule as the [job search](#job-search-postgres-mode): only the owner sees the screens and the data, anyone else gets a 404, and in static and git mode every Reading screen and route answers 404 and the sidebar's Reading group is hidden.

**Who the digest is for.** Under **Reading → Settings → Profile**, describe your **Field** in a few sentences, list **Keywords**, and name your **Wider area** one level up ("machine learning", "neuroscience"). The field and keywords drive the in-field list; the wider area drives the talked-about one. **Suggest from my profile** makes one AI call that reads your CV, research areas and up to 40 of your publications and fills in the field, keywords, wider area and each source it can (arXiv, bioRxiv and medRxiv categories, a PubMed query, OpenAlex topics), turning on each source it fills. It turns Hugging Face on only when the area is machine learning or AI. Nothing is saved until you press Save.

**Sources.** Turn them on under **Reading → Settings → Sources**. "New today" sources feed the in-field list; traction sources feed the talked-about list.

| Source                       | Kind      | Key                           | On by default | Notes                                                                                                                                                                                        |
| ---------------------------- | --------- | ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| arXiv (`arxiv`)              | new today | none                          | no            | The RSS feed of your categories (`cs.CL`, `q-bio.NC`…), new and cross-listed papers only. arXiv is called at most once every 3 seconds across the site                                       |
| bioRxiv (`biorxiv`)          | new today | none                          | no            | The last two days in your categories, 30 a page, at most 10 pages a category; a paper posted in several versions is kept once. Categories are lowercase with `_` for spaces (`cell_biology`) |
| medRxiv (`medrxiv`)          | new today | none                          | no            | As bioRxiv. medRxiv's "HIV/AIDS" is `hiv_aids`: a slash makes the API ignore the category and return every paper                                                                             |
| PubMed (`pubmed`)            | new today | none                          | no            | Your query over the last two days by entry date, up to 200 papers. NCBI calls are 340 ms apart                                                                                               |
| OpenAlex (`openalex`)        | traction  | `OPENALEX_API_KEY` (optional) | no            | The most cited articles, preprints and reviews of the last 60 days in the fields and subfields you pick by name (50 per level). Datasets, dissertations and journal records are left out     |
| Hugging Face (`huggingface`) | traction  | none                          | no            | The Daily Papers of the last 7 days, the 50 most upvoted of each day (7 requests). Machine learning only                                                                                     |
| Bluesky (`bluesky`)          | mentions  | none                          | yes           | For the talked-about papers only: posts in the last 60 days linking the paper's arXiv page, else naming its DOI. Counts stop at 100 ("100+ Bluesky posts"). On its own it starts no digest   |
| alphaXiv (`alphaxiv`)        | traction  | none                          | no            | Unofficial: no public API, it can break without notice. Visits over the last 7 days                                                                                                          |

**OpenAlex key.** Without `OPENALEX_API_KEY`, OpenAlex shares a small daily budget (about $0.10) with everyone calling from the same IP address, which on Vercel can run out before your run. A free key (verified email) gives $1 a day. Save it under **Integrations → Keys**; Settings says when it is missing. Without it, requests carry a `mailto` instead.

**The nightly run.** The daily cron (03:00 UTC) starts it once a source other than Bluesky is on; **Run now** starts it any time, and a run that is still going is not started twice. It is a [Vercel Workflow](https://vercel.com/docs/workflows), like the job search.

1. **Collect.** Each new-today source's papers are fetched; the 60 with the most keyword overlap are stored, and papers shown on an earlier day, saved or dismissed are left out. The 60 closest to your keywords across all sources form the night's pool. Papers never shown are deleted after 30 days.
2. **Rank in-field papers.** The AI scores the pool ten papers per call against your field, keywords, research areas and up to 40 of your publications: a 0–100 score, a one-line reason and, when one fits, the paper of yours it is close to. Papers already scored cost no new call, so a second run the same day is cheap. **New in your field** keeps the best **8** (`inField`) at or above the minimum score (**60**). A short list is not padded; one sentence says why.
3. **Collect talked-about papers.** Candidates from the traction sources that were not shown before are ranked by their numbers; one AI call drops those outside your wider area (it can only drop, and with no wider area set there is no call). Bluesky counts are added. The list keeps the best **5** (`talked`), ranked by each paper's best share of the night's highest number per source (Hugging Face upvotes, OpenAlex citations, alphaXiv visits) plus half its share of the highest Bluesky count. A paper shown as talked-about comes back only once one of its numbers has at least doubled.
4. **Fetch text ahead.** The arXiv HTML of each digest paper is fetched 15 seconds apart (arXiv's crawl delay) and stored privately for the reading room to come. It is not shown yet.
5. **Save and send.** The day's digest replaces any earlier one for the same day, and the email goes out if it is on.

**At most 20 AI calls a night** (`AI calls per night`, up to 100). Papers left when the cap is spent are listed under **Not ranked tonight**.

**Numbers, not hype.** Every talked-about line is built in code from a named source's numbers ("120 upvotes and 8 comments on Hugging Face in 3 days · cited 14 times since 2 Sep 2026 (OpenAlex) · 42 Bluesky posts"). The AI never adds a paper and never changes a number. Titles, abstracts and author names are treated as untrusted data in every prompt and are never rendered as HTML.

**Failures stay local.** A source that fails is named under the run strip and the rest of the digest still appears. A provider error, or a missing AI key, stops ranking for the night: no other provider is tried, and the unscored papers are listed under **Not ranked tonight** with the reason.

**Today.** **People are talking about** and **New in your field**, each paper with its authors, source and date, its numbers or reason, **Save** and **Dismiss**; earlier days are listed by date below. The run strip shows the last run with **Run now**, and the dashboard's Reading row shows today's count, or that ranking stopped.

**Email digest.** **Reading → Settings → Digest → Email** sends the day's digest after each run. It is off by default and uses the job search's `RESEND_API_KEY` (see [Email digest](#email-digest)); **To** defaults to the email on your CV. A day with nothing in it sends nothing, and a failed email is noted on the run, never failing it.

**Pause** under the same section makes every run do nothing.

**Where the data lives.** `reading_settings`, `reading_papers`, `reading_digest` and `reading_texts` (migration `008_reading.sql`), not `documents`, so they never reach the git backup or `db:export`. As with the job search, a Vercel preview shares the production database: a run on a preview writes the live digest and spends your real AI credits.

### Cookie Consent (GDPR)

Optional GDPR-compliant cookie consent banner:

```yaml
cookieConsent: true # false to disable
```

When enabled, analytics scripts are blocked until the visitor accepts.

### Internationalization (i18n)

Built-in support for any language and text direction:

```yaml
lang: 'en' # BCP 47 language tag (en, fa, ar, zh, de, etc.)
direction: 'ltr' # "ltr" or "rtl"
```

The entire layout flips for RTL languages like Arabic, Persian, and Hebrew.

### View Transitions

Smooth, app-like page transitions powered by Astro's ClientRouter:

- **Fade animations** -- seamless navigation between pages
- **Theme persistence** -- dark mode preserved across transitions
- **No full-page reload** -- instant navigation feel

---

## Configuration

All configuration lives in the `config/` directory. No code changes needed.

### Site Configuration

The main configuration file is `config/site.yml`:

```yaml
# Mode
siteMode: 'personal' # "personal" or "lab"

# Identity
title: 'My Research Lab'
author: 'Prof. Jane Smith'
labName: 'Smith Research Lab'
university: 'MIT'
department: 'Department of Computer Science'
siteUrl: 'https://your-site.github.io'
description: 'A brief description of your research.'

# Default theme
defaultTheme: 'system' # "light" | "dark" | "system"

# Image shape for photos
imageShape: 'circular' # "rectangular" | "circular" | "oval"
```

### Colors & Typography

The quickest way to brand the site: two hex colors (Settings → Theme & colors → Brand, or `site.yml`):

```yaml
brand:
  primary: '#7c3aed'
  secondary: '#14b8a6'
```

The site derives the rest: the accent for links, buttons and tiles in light and dark mode (darkened or lifted only
as far as 4.5:1 contrast needs), its hover, border and selection shades, the classic theme's palettes, and the hero
pattern's gradient (primary to secondary, unless the pattern has its own color). Brand colors replace `colors`
below; leave `brand` out to set each color yourself.

Or customize the visual identity color by color, with Google Fonts:

```yaml
colors:
  light:
    primary: '#2c5282'
    secondary: '#06b6d4'
  dark:
    primary: '#22d3ee'
    secondary: '#2c5282'

fonts:
  families:
    sans: 'Inter'
    serif: 'Playfair Display'
    mono: 'JetBrains Mono'
  sizes:
    base: '1rem'
    h1: '2.25rem'
    h2: '1.5rem'
```

ScholarOS automatically generates a full shade palette (50-950) from your primary and secondary colors using CSS `color-mix()`.

### Navigation

Fully customizable navigation menu:

```yaml
nav:
  - label: 'Research'
    href: '/research'
  - label: 'Publications'
    href: '/publications'
  - label: 'Blog'
    href: '/blog'
  - label: 'CV'
    href: '/cv'
  - label: 'Contact'
    href: '/contact'
```

An optional top bar is also available:

```yaml
topBar:
  enabled: true
  text: 'Department of Computer Science, MIT'
  links:
    - label: 'Apply Now'
      href: '/positions'
```

### Social Links

Connect all your academic profiles:

```yaml
socials:
  email: 'you@university.edu'
  github: 'https://github.com/you'
  scholar: 'https://scholar.google.com/citations?user=YOUR_ID'
  twitter: 'https://twitter.com/you'
  linkedin: 'https://linkedin.com/in/you'
  orcid: 'https://orcid.org/0000-0000-0000-0000'
  mastodon: 'https://mastodon.social/@you'
  bluesky: 'https://bsky.app/profile/you.bsky.social'
  website: 'https://your-other-site.com'
```

### Homepage Sections

Control which sections appear on the homepage and their order:

```yaml
homepageSections:
  - id: hero
    enabled: true
  - id: about
    enabled: true
  - id: news
    enabled: true
  - id: publications
    enabled: true
  - id: blog
    enabled: false # hide the blog section
```

### Logo

Set a logo in the admin (Settings → Identity → Logo) or in `site.yml`:

```yaml
logo: '/images/logo.svg' # a file in public/images/
```

It shows beside the name in the header, 28px tall at its own proportions, so a wide wordmark works. Dark line art on a transparent background is inverted in dark mode, so an ink logo stays visible.

The browser-tab and home-screen icons are the files in `public/`: `favicon.ico`, `favicon.svg`, `favicon-96x96.png`, `apple-touch-icon.png` (180px, opaque), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `site.webmanifest`. Replace them with your own, or upload one in the admin (Settings → Identity → Favicon, or `favicon:` in `site.yml`): a square PNG, at least 180px, on a solid background, used for the tab and the phone home screen.

### Turning Pages Off

Turn a built-in page off in the admin (Pages → On/off) or in `site.yml`:

```yaml
pages:
  talks: false
  repositories: false
```

A page that is off leaves the menu, the footer and the sitemap, and its address (with everything under it, such as `/blog/a-post`) shows Not found. Its content stays. Turning off `news` or `blog` also hides that home-page section. The pages are `research`, `people`, `publications`, `cv`, `projects`, `news`, `blog`, `talks`, `positions`, `join`, `repositories` and `contact`.

---

## Content Collections

All content is stored as Markdown files in `src/content/`:

| Collection        | Directory                    | Schema Fields                                                                       |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| **People**        | `src/content/people/`        | name, role, title, photo, email, socials, researchInterests, active                 |
| **Publications**  | `src/content/publications/`  | title, authors, venue, year, doi, url, pdf, bibtex, type, featured, abstract, image |
| **Blog Posts**    | `src/content/posts/`         | title, date, author, excerpt, coverImage, tags, draft                               |
| **Announcements** | `src/content/announcements/` | title, date, category, pinned, emoji, excerpt                                       |
| **Projects**      | `src/content/projects/`      | title, type, status, image, url, repoUrl, team, tags                                |
| **Positions**     | `src/content/positions/`     | title, type, status, deadline, excerpt, tags, contact                               |
| **Talks**         | `src/content/talks/`         | title, event, date, location, type, slidesUrl, videoUrl                             |
| **Feeds**         | `src/data/feeds.json`        | title, link, date, source, excerpt                                                  |

### Adding a Publication

Create `src/content/publications/my-paper.md`:

```yaml
---
title: 'Your Paper Title'
authors:
  - 'Jane Smith'
  - 'Alex Chen'
venue: 'NeurIPS 2025'
year: 2025
type: 'conference' # journal | conference | preprint | workshop | thesis | book-chapter
doi: '10.1234/example'
url: 'https://arxiv.org/abs/2025.00001'
pdf: 'https://arxiv.org/pdf/2025.00001'
bibtex: |
  @inproceedings{smith2025paper,
    title={Your Paper Title},
    author={Smith, Jane and Chen, Alex},
    booktitle={NeurIPS},
    year={2025}
  }
featured: true
---
Optional abstract or notes in Markdown.
```

### Adding a Team Member

Create `src/content/people/jane-smith.md`:

```yaml
---
name: 'Jane Smith'
role: 'pi' # pi | postdoc | phd | masters | undergrad | research-assistant | visiting | alumni
title: 'Associate Professor'
email: 'jane@university.edu'
photo: './photos/jane.jpg'
socials:
  github: 'https://github.com/janesmith'
  scholar: 'https://scholar.google.com/citations?user=XXXX'
  twitter: 'https://twitter.com/janesmith'
  orcid: 'https://orcid.org/0000-0000-0000-0000'
researchInterests:
  - 'Natural Language Processing'
  - 'AI Safety'
sortOrder: 1
active: true
---
Your full bio in Markdown. This appears on the individual profile page.
```

### Adding a Blog Post

Create `src/content/posts/my-first-post.md`:

````yaml
---
title: "My First Blog Post"
date: 2025-01-15
author: "Jane Smith"
excerpt: "A brief summary of the post."
tags:
  - "Research"
  - "NLP"
draft: false
---

Your blog post content in **Markdown** or MDX.

You can use $\LaTeX$ math: $E = mc^2$

```python
# And code blocks with syntax highlighting
def hello():
    print("Hello, world!")
````

```

---

## Project Structure

```

ScholarOS/
├── .github/workflows/ # CI/CD automation
│ ├── deploy.yml # Build & deploy to GitHub Pages
│ ├── migrate-al-folio.yml # One-click al-folio migration
│ ├── sync-feeds.yml # Sync external RSS feeds
│ ├── sync-scholar.yml # Sync Google Scholar publications
│ ├── render-cv.yml # Generate CV PDF
│ ├── generate-seo.yml # Auto-generate SEO keywords
│ ├── sync-template.yml # Sync upstream template updates
│ └── template-init.yml # First-time setup
├── config/ # All configuration (YAML)
│ ├── site.yml # Main site config
│ ├── cv.yml # CV / resume data
│ ├── cv-styles.yml # CV PDF styles (optional)
│ ├── research.yml # Research areas
│ ├── feeds.yml # External RSS feed sources
│ ├── scholar.yml # Google Scholar sync config
│ └── cms.yml # CMS panel config
├── cv/themes/ # Custom CV themes (optional)
├── services/cv-render/ # Private RenderCV service (Vercel Services) and shared renderer
├── public/ # Static assets (served as-is)
├── scripts/ # Automation scripts
│ ├── migrate-al-folio.ts # al-folio migration
│ ├── sync-feeds.ts # RSS feed aggregation
│ ├── sync-scholar.py # Google Scholar sync
│ ├── render-cv.py # CV PDF generation
│ └── generate-seo-keywords.ts # SEO keyword extraction
├── src/
│ ├── components/
│ │ ├── astro/ # Static components (zero JS)
│ │ └── vue/ # Interactive islands (hydrated on demand)
│ ├── content/ # Markdown content collections
│ │ ├── announcements/
│ │ ├── people/
│ │ ├── positions/
│ │ ├── posts/
│ │ ├── projects/
│ │ ├── publications/
│ │ └── talks/
│ ├── layouts/ # Page layouts
│ ├── lib/ # Utilities, config loader, types
│ ├── pages/ # Route pages
│ └── styles/ # Global CSS
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
└── package.json

````

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage with hero, about, news, publications, and blog widgets |
| `/research` | Research areas with related projects and publications |
| `/people` | Team directory grouped by role |
| `/people/[id]` | Individual member profile |
| `/publications` | Filterable publication list with search, year/type filters |
| `/projects` | Project showcase with status and type indicators |
| `/projects/[id]` | Project detail page |
| `/news` | News and announcements with category filtering |
| `/news/[id]` | Individual announcement |
| `/news/category/[cat]` | News filtered by category |
| `/blog` | Blog with posts and aggregated external feeds |
| `/blog/[id]` | Individual blog post with ToC and prose styling |
| `/blog/tag/[tag]` | Blog posts filtered by tag |
| `/talks` | Talks and presentations timeline |
| `/positions` | Open positions with application status |
| `/positions/[id]` | Position detail with application form |
| `/repositories` | GitHub totals, pinned repos, languages and recent activity |
| `/cv` | CV page with PDF download |
| `/contact` | Contact form |
| `/join` | Lab recruitment page |
| `/feed.xml` | RSS feed |
| `/admin` | CMS admin panel |

---

## Automation Workflows

ScholarOS includes 8 GitHub Actions workflows that keep your site up to date automatically:

| Workflow | Trigger | What it Does |
|----------|---------|--------------|
| **Deploy** | Push to `main` | Builds the site and deploys to GitHub Pages |
| **Migrate al-folio** | `site.yml` change / manual | Migrates content from an al-folio repository |
| **Sync Feeds** | Scheduled / manual | Fetches latest posts from external RSS feeds |
| **Sync Scholar** | Scheduled / manual | Pulls publications from your Google Scholar profile |
| **Render CV** | `cv.yml` change / manual | Generates a PDF from your CV YAML using RenderCV |
| **Generate SEO** | Content change / manual | Analyzes content and generates optimized keywords |
| **Sync Template** | Manual | Pulls latest updates from upstream ScholarOS template |
| **Template Init** | First use | Initializes the template with your configuration |

---

## Deployment

### GitHub Pages (Recommended)

1. Go to **Settings > Pages > Build and deployment > Source** and select **GitHub Actions**
2. Push to `main` -- the included workflow handles everything
3. Your site will be live at `https://YOUR_USERNAME.github.io/YOUR_REPO/`

### Netlify

1. Connect your repository on [Netlify](https://netlify.com)
2. Build settings are auto-detected from `netlify.toml`

### Cloudflare Pages

1. Connect your repository on [Cloudflare Pages](https://pages.cloudflare.com)
2. Build command: `pnpm build`
3. Build output directory: `dist`
4. Node.js version: `22`

### Vercel

The [Deploy button](#one-click-deploy-on-vercel) sets up a Postgres-mode site in one step. To deploy an existing
repository instead:

1. Import your repository on [Vercel](https://vercel.com)
2. Framework preset: **Astro**
3. Everything else is auto-detected

---

## Migration from al-folio

Already using [al-folio](https://github.com/alshedivat/al-folio)? ScholarOS can migrate your content automatically.

### Automatic Migration (Recommended)

1. Fork or create a new ScholarOS repository
2. Edit `config/site.yml` and set:

```yaml
alfolioRepo: "https://github.com/YOUR_USERNAME/YOUR_AL_FOLIO_REPO"
````

3. Push the change. The migration workflow will:
   - Clone your al-folio repository
   - Convert `_data/` configs, `_bibliography/`, `_projects/`, `_posts/`, `_news/`, and team data
   - Migrate images and assets
   - Commit the converted content
   - Clear the `alfolioRepo` field
   - Trigger a fresh deploy

### Manual Migration

```bash
# Set the al-folio repo URL in config/site.yml, then run:
pnpm migrate:al-folio
```

---

## Tech Stack

| Technology                                 | Purpose                                         |
| ------------------------------------------ | ----------------------------------------------- |
| [Astro 7](https://astro.build)             | Static site generator with island architecture  |
| [Vue 3](https://vuejs.org)                 | Interactive components (search, filters, forms) |
| [Tailwind CSS v4](https://tailwindcss.com) | Utility-first styling with CSS variables        |
| [MDX](https://mdxjs.com)                   | Enhanced Markdown with component support        |
| [TypeScript](https://typescriptlang.org)   | Type-safe configuration and utilities           |
| [Sharp](https://sharp.pixelplumbing.com)   | Automatic image optimization                    |
| [GSAP](https://gsap.com)                   | Hero background animations                      |
| [Web3Forms](https://web3forms.com)         | Contact & newsletter forms (no backend)         |
| [RenderCV](https://rendercv.com)           | PDF CV generation from YAML                     |

---

## Contributing

We welcome contributions of all kinds! Whether it's fixing a typo, adding a new feature, improving documentation, or reporting a bug -- every contribution helps make ScholarOS better for the academic community.

Please read our [Contributing Guide](CONTRIBUTING.md) for details on:

- Setting up the development environment
- Finding good first issues
- Submitting pull requests
- Code style and conventions

---

## Star History

<a href="https://star-history.com/#yazdanimehdi/ScholarOS&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=yazdanimehdi/ScholarOS&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=yazdanimehdi/ScholarOS&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=yazdanimehdi/ScholarOS&type=Date" />
 </picture>
</a>

---

## Acknowledgments

ScholarOS was inspired by [**al-folio**](https://github.com/alshedivat/al-folio), a beautiful and widely-adopted Jekyll theme for academics. al-folio set the standard for what an academic website template should include, and its influence on the features and content model of ScholarOS is significant. If you're looking for a mature, battle-tested Jekyll-based solution, al-folio is an excellent choice and we encourage you to check it out.

ScholarOS takes a different architectural approach -- Astro's island architecture, YAML-driven configuration, and GitHub Actions automation -- but the goal is the same: give researchers a professional web presence with minimal friction. We are grateful to the al-folio maintainers and contributors for their work.

---

## License

ScholarOS is open source under the [MIT License](LICENSE).

You are free to use this template for your personal or lab website. A link back to ScholarOS in your footer is appreciated but not required.

---

<p align="center">
  Made with care for the academic community.
  <br>
  If ScholarOS helps you, please consider giving it a <a href="https://github.com/yazdanimehdi/ScholarOS">star</a>.
</p>
