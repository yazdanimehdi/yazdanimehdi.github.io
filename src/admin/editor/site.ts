/** Pure helpers for the Site editor screen (Editor.vue): what a reason means, how changes group, how a diff reads. */
import type { ChangedFile } from '../../lib/admin/editor';
import { TEXT_PROVIDERS, type TextProviderId } from '../../lib/ai/providers';

export const README = 'More in the README, section “Site editor”.';

/** What the screen says when the editor can't start, and the one thing to do about it. */
export interface Notice {
  title: string;
  body: string;
  action: 'copy' | 'ai' | 'retry';
  /** Plain-text steps for "Copy setup steps". */
  steps?: string;
  /** The server's own text, behind "Technical details". */
  raw: string;
}

const GITHUB_TOKEN_STEPS = `Site editor setup: GitHub token
1. On GitHub, create a fine-grained personal access token (Settings → Developer settings → Personal access tokens → Fine-grained tokens) for this site's repository only, with Contents: Read and write.
2. In Vercel, open the project → Settings → Environment Variables, and add the token as GITHUB_TOKEN.
3. Redeploy, then open the Site editor again.
${README}`;

const GITHUB_REPO_STEPS = `Site editor setup: which repository
1. In Vercel, open the project → Settings → Environment Variables.
2. Add GITHUB_REPO with the site's repository as owner/name, for example jane/my-site.
3. Redeploy, then open the Site editor again.
${README}`;

const VERCEL_STEPS = `Site editor setup: the admin on Vercel
1. Import the repository in Vercel and set the admin's environment variables (README, section “Deploy on Vercel (custom admin)”).
2. Make sure GITHUB_TOKEN has Contents: Read and write.
3. Add a key for the writing provider on the Integrations screen.
${README}`;

const SANDBOX_SIGN_IN_STEPS = `Site editor setup: signing in to Vercel Sandbox
On Vercel this sign-in is automatic; if this appears there, redeploy.
On your own computer:
1. In the project folder, run: vercel link
2. Then run: vercel env pull
   This saves a VERCEL_OIDC_TOKEN for the dev server. It expires after about 12 hours; pull again when it does.
3. Restart the dev server.
${README}`;

/** First match wins. Each pattern is pinned to the server's message by site.test.ts. */
const NOTICES: { match: RegExp; notice: Omit<Notice, 'raw'> }[] = [
  {
    match: /not in a static build/,
    notice: {
      title: 'The Site editor needs the admin on Vercel',
      body: 'This site is built as static pages. The Site editor works only when the admin runs on Vercel.',
      action: 'copy',
      steps: VERCEL_STEPS,
    },
  },
  {
    match: /^GITHUB_TOKEN is not set/,
    notice: {
      title: 'Connect the site’s GitHub repository',
      body: 'The Site editor publishes through GitHub, and this deployment has no GitHub token yet. Add one in the Vercel project settings, then redeploy.',
      action: 'copy',
      steps: GITHUB_TOKEN_STEPS,
    },
  },
  {
    match: /^Set GITHUB_REPO/,
    notice: {
      title: 'Say which repository holds the site',
      body: 'Vercel didn’t report which GitHub repository this site deploys from. Name it in the Vercel project settings, then redeploy.',
      action: 'copy',
      steps: GITHUB_REPO_STEPS,
    },
  },
  {
    match: /^Vercel Sandbox: .*(OIDC|credential|token|unauthori[sz]ed|forbidden|\b40[13]\b)/i,
    notice: {
      title: 'The admin can’t sign in to Vercel Sandbox',
      body: 'On Vercel this happens by itself. When the admin runs on your own computer, link the project and pull its settings first; the sign-in expires after about 12 hours.',
      action: 'copy',
      steps: SANDBOX_SIGN_IN_STEPS,
    },
  },
  {
    match: /^Vercel Sandbox:/,
    notice: {
      title: 'Vercel Sandbox can’t be reached right now',
      body: 'The service where the agent works didn’t answer. This is usually brief.',
      action: 'retry',
    },
  },
  {
    match: /_API_KEY is not set/,
    notice: {
      title: 'Add a key for the AI provider',
      body: 'The agent runs on the writing provider chosen on the Integrations screen, and that provider has no key yet. Add it there, then come back.',
      action: 'ai',
    },
  },
];

/** The numbered steps of a notice's setup text, for its list; a step's indented lines stay part of it. */
export function stepItems(steps: string): string[] {
  const items: string[] = [];
  for (const line of steps.split('\n')) {
    const step = /^\d+\.\s+(.*)/.exec(line);
    if (step) items.push(step[1]);
    else if (/^\s/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

/** A reason from the server as plain language plus one action; unknown text stays the headline as it is. */
export function explain(raw: string): Notice {
  const known = NOTICES.find((n) => n.match.test(raw));
  if (known) return { ...known.notice, raw };
  return { title: 'The Site editor can’t start here', body: raw, action: 'retry', raw };
}

const AGENTS: Record<TextProviderId, string> = { anthropic: 'Claude Code', openai: 'Codex', google: 'Gemini CLI' };

/** "Claude Code (Anthropic)": the coding tool and whose account it runs on. */
export const agentLabel = (provider: TextProviderId) =>
  `${AGENTS[provider] ?? provider} (${TEXT_PROVIDERS[provider]?.label ?? provider})`;

export const providerLabel = (provider: TextProviderId) => TEXT_PROVIDERS[provider]?.label ?? provider;

export type FileKind = 'refused' | 'pages' | 'styles' | 'content' | 'other';

const KINDS: { kind: FileKind; label: string }[] = [
  { kind: 'refused', label: 'Can’t be published' },
  { kind: 'pages', label: 'Pages and layout' },
  { kind: 'styles', label: 'Styles' },
  { kind: 'content', label: 'Content and settings' },
  { kind: 'other', label: 'Images and other files' },
];

export function fileKind(f: ChangedFile): FileKind {
  if (!f.allowed) return 'refused';
  if (/\.(css|scss|sass|less)$/.test(f.path) || f.path.startsWith('src/styles/')) return 'styles';
  if (/^src\/(pages|layouts|components|themes)\//.test(f.path)) return 'pages';
  if (/^(src\/content|src\/data|config)\//.test(f.path)) return 'content';
  return 'other';
}

/** Non-empty groups in a fixed order, refused files first: they are what stands between the owner and Publish. */
export function groupFiles(files: ChangedFile[]) {
  return KINDS.map((k) => ({ ...k, files: files.filter((f) => fileKind(f) === k.kind) })).filter((g) => g.files.length);
}

/** Theme page components and the file under src/pages that renders each; site.test.ts checks the pages' imports. */
const THEME_PAGES: Record<string, string> = {
  Home: 'index',
  Publications: 'publications',
  Research: 'research',
  Cv: 'cv',
  Contact: 'contact',
  Repositories: 'repositories',
  Talks: 'talks',
  Join: 'join',
  NotFound: '404',
  Blog: 'blog/index',
  BlogTag: 'blog/tag/[tag]',
  Post: 'blog/[id]',
  News: 'news/index',
  NewsEntry: 'news/[id]',
  People: 'people/index',
  Person: 'people/[id]',
  Positions: 'positions/index',
  PositionsEntry: 'positions/[id]',
  Projects: 'projects/index',
  Project: 'projects/[id]',
  ProjectsDetail: 'projects/[id]',
  Readings: 'readings/index',
  Reading: 'readings/[slug]',
  Notes: 'notes/index',
  Note: 'notes/[slug]',
};
/** Content collections and the page that lists them. */
const COLLECTION_PAGES: Record<string, string> = {
  posts: 'blog/index',
  publications: 'publications',
  announcements: 'news/index',
  people: 'people/index',
  projects: 'projects/index',
  talks: 'talks',
  positions: 'positions/index',
};
const PAGE_LABELS: Record<string, string> = { '': 'Home', '404': 'Not found', cv: 'CV' };

export interface ChangedPage {
  label: string;
  /** The route, for the preview. */
  path: string;
}

/**
 * A page file (`blog/[id]`) as a link: "Blog". A route with a [param] is many pages ("Blog pages"); its link goes to
 * the section's first page, which lists them.
 */
function pageLink(file: string): ChangedPage {
  const segments = file.split('/').filter((s) => s !== 'index');
  const at = segments.findIndex((s) => s.startsWith('['));
  const fixed = at < 0 ? segments : segments.slice(0, at);
  const name = fixed.join(' ');
  const label = PAGE_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
  return at < 0 ? { label, path: `/${fixed.join('/')}` } : { label: `${label} pages`, path: `/${fixed[0] ?? ''}` };
}

/**
 * The pages a change set shows on, where the paths say: page files, theme page components, content collections.
 * Layouts, styles, shared components, other theme files and config/site.yml change `every` page. Files that say
 * neither (images, data) add nothing.
 */
export function changedPages(paths: string[]): { every: boolean; pages: ChangedPage[] } {
  let every = false;
  const pages = new Map<string, ChangedPage>();
  for (const p of paths) {
    const page = /^src\/pages\/(?!_)(.+)\.(astro|md|mdx)$/.exec(p)?.[1];
    const theme = /^src\/themes\/[^/]+\/(.+)$/.exec(p)?.[1];
    const component = theme && THEME_PAGES[theme.replace(/\.astro$/, '')];
    const collection = COLLECTION_PAGES[/^src\/content\/([^/]+)\//.exec(p)?.[1] ?? ''];
    const file = page ?? component ?? collection;
    if (file) {
      const link = pageLink(file);
      pages.set(`${link.path} ${link.label}`, link);
    } else if (theme || /^src\/(layouts|styles|components)\//.test(p) || p === 'config/site.yml') every = true;
  }
  return { every, pages: [...pages.values()] };
}

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'context';

/**
 * `git diff` text as lines tagged for colour; the leading +/- stays in the text, so colour is never the only sign.
 * A file's `diff --git` line carries its path (`file`), so the file list can link to it.
 */
export function diffLines(diff: string): { kind: DiffLineKind; text: string; file?: string }[] {
  const lines = diff.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((text) => ({
    text,
    file: diffPath(text),
    kind: /^(diff |index |--- |\+\+\+ |new file mode|deleted file mode|Binary files)/.test(text)
      ? 'meta'
      : text.startsWith('@@')
        ? 'hunk'
        : text.startsWith('+')
          ? 'add'
          : text.startsWith('-')
            ? 'del'
            : 'context',
  }));
}

/** "45s", "2m 10s", "1h 5m"; a clock behind the server's never shows a negative time. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

/**
 * `diff --git a/P b/P` (--no-renames, so both sides are the same path, spaces included) → P. Paths git had to quote
 * get no link.
 */
function diffPath(line: string): string | undefined {
  if (!line.startsWith('diff --git a/')) return undefined;
  const rest = line.slice('diff --git '.length);
  const n = (rest.length - 5) / 2;
  const path = rest.slice(2, 2 + n);
  return Number.isInteger(n) && n > 0 && rest === `a/${path} b/${path}` ? path : undefined;
}

const ERROR_LINE = /^Failed:|\b(error|failed|fatal|exception|denied|refused)\b/i;
/** Wrapper lines that only say a step ended badly ("exited with code 1"): any line naming what went wrong beats them. */
const GENERIC_LINE = /\b(exit(ed)? (with )?(code|status)|ELIFECYCLE|command failed)\b/i;

/**
 * The line of a failed run's log that says what went wrong: the last specific error-like line, else the last
 * error-like one, else the last line.
 */
export function failureLine(log: string): string {
  const lines = log
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const errors = lines.filter((l) => ERROR_LINE.test(l));
  const found = errors.findLast((l) => !GENERIC_LINE.test(l)) ?? errors.at(-1) ?? lines.at(-1);
  const text = (found ?? '').replace(/^Failed:\s*/, '');
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}
