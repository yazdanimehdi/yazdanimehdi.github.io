/** What the site editor may publish: the site's look and content, never admin, auth, server code or dependencies. */
const ALLOWED = [
  /^src\/(components|layouts|pages|styles|themes|assets|content)\//,
  /^src\/data\/[^/]+\.json$/,
  /^public\//,
  /^config\/[^/]+\.yml$/,
];

/** Wins over ALLOWED. */
const REFUSED = [
  /^src\/admin\//,
  /^src\/lib\//,
  /^src\/middleware/,
  /^src\/integrations\//,
  /^src\/pages\/(.+\/)?api(\/|$)/,
  /^src\/data\/(jobs|scholar)\.json$/,
  /^config\/ai\.yml$/,
  /^migrations\//,
  /^scripts\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^astro\.config\./,
  /^vercel\.(json|ts)$/,
  /^netlify\.toml$/,
  /[\p{Cc}\\]/u,
];

/** Dot-file segments cover `.github/`, `.env*` and `..`. */
export function inEditorScope(path: string): boolean {
  if (path.length > 300 || path.split('/').some((s) => s === '' || s.startsWith('.'))) return false;
  return !REFUSED.some((r) => r.test(path)) && ALLOWED.some((r) => r.test(path));
}
