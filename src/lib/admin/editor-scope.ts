/**
 * What the site editor may publish: the site's look and content, never admin, auth, server code or dependencies.
 * Pages may only be .astro/.md/.mdx: a .ts file under src/pages is an endpoint, and in Postgres mode every route runs
 * with the database URL and tokens in its environment. `.astro` frontmatter is server code too; that residual risk is
 * accepted because an admin reviews the diff before Publish.
 */
const ALLOWED = [
  /^src\/pages\/.+\.(astro|md|mdx)$/,
  /^src\/content\/.+\.(md|mdx|json|ya?ml)$/,
  /^src\/(components|layouts|styles|themes|assets)\//,
  /^public\//,
  /^src\/data\/[^/]+\.json$/,
  /^config\/[^/]+\.yml$/,
];

/** Wins over ALLOWED. */
const REFUSED = [
  /^src\/admin\//,
  /^src\/lib\//,
  /^src\/middleware/,
  /^src\/integrations\//,
  /^src\/pages\/(.+\/)?api(\/|\.|$)/,
  /^src\/content\/config\./,
  /^src\/data\/(jobs|scholar)\.json$/,
  /^config\/ai\.yml$/,
  /^migrations\//,
  /^scripts\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^astro\.config\./,
  /^vercel\.(json|ts)$/,
  /^netlify\.toml$/,
  // Server-only modules, and files named like an endpoint (`feed.xml.ts`) or middleware, wherever they sit.
  /\.(mts|cts|cjs|mjs)$/,
  /(^|\/)middleware(\.[^/]*$|\/)/,
  /^src\/.*\.[a-z0-9]+\.(ts|js)$/i,
  /[\p{Cc}\\]/u,
];

/** Dot-file segments cover `.github/`, `.env*` and `..`. */
export function inEditorScope(path: string): boolean {
  if (path.length > 300 || path.split('/').some((s) => s === '' || s.startsWith('.'))) return false;
  return !REFUSED.some((r) => r.test(path)) && ALLOWED.some((r) => r.test(path));
}
