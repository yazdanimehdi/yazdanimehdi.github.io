import type { MiddlewareHandler } from 'astro';
import { SESSION_COOKIE, openSession, sessionSecret } from './lib/admin/session';
import { isAllowed } from './lib/admin/access';
import { adminSettings } from './lib/admin/settings';
import { cacheTagHeader } from './lib/cache-tags';
import { isPageOn } from './lib/config';
import { loadSiteFiles, newContext, runWithContext } from './lib/content/context';
import { getSql, isUnreachable } from './lib/db';
import { getMode } from './lib/mode';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const jsonError = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });

const UNAVAILABLE =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Temporarily unavailable</title>' +
  '<p style="font-family:system-ui;margin:4rem auto;max-width:32rem;padding:0 1rem">This site is temporarily unavailable. Please try again in a minute.</p>';

function unavailable(): Response {
  return new Response(UNAVAILABLE, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' },
  });
}

const NO_BODY = new Set([101, 204, 205, 304]);

/** Bodyless, so Astro renders 404.astro on a request and writes no file for a prerendered page. */
const notFound = () => new Response(null, { status: 404 });

/** Postgres mode, public GET/HEAD: render inside a request context, then cache on the CDN tagged with what it read. */
async function publicPage(pathname: string, next: () => Promise<Response>): Promise<Response> {
  let files: Map<string, string>;
  try {
    files = await loadSiteFiles(getSql());
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[middleware] database unreachable', e);
    return unavailable(); // pages already in the CDN cache keep being served from it
  }
  const context = newContext(files);
  return runWithContext(context, async () => {
    let res: Response;
    let body: ArrayBuffer | null;
    try {
      // A failing page query rejects next(); a failing child component errors the body stream.
      res = isPageOn(pathname) ? await next() : notFound();
      // Child components read content while the body streams: finish rendering here so every read is in the context.
      // A null body stays null: Astro reroutes a bodyless 404 to 404.astro.
      // ponytail: the whole page is buffered in memory (no streaming, later TTFB); to stream, pass the body through and set tags via a trailing mechanism or addCacheTag before the body.
      body = res.body === null || NO_BODY.has(res.status) ? null : await res.arrayBuffer();
    } catch (e) {
      if (context.dbFailed) return unavailable();
      throw e;
    }
    if (context.dbFailed) return unavailable();
    const out = new Response(body, res);
    if (res.status === 200) {
      out.headers.set('Vercel-CDN-Cache-Control', 'public, max-age=31536000');
      out.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      out.headers.set('Vercel-Cache-Tag', cacheTagHeader(context.tags));
    } else {
      out.headers.set('Cache-Control', 'no-store');
    }
    return out;
  });
}

/** Guards the admin (pages under /<adminPath>, API under /api/admin): session, same-origin writes, no caching or indexing. Public pages turned off in site.yml 404. Postgres mode: renders public pages inside a request context and sets CDN cache headers. */
export const onRequest: MiddlewareHandler = async (ctx, next) => {
  // @astrojs/vercel 8 lets this header replace the request path, and only its edge middleware (off here) sets it. A
  // client sending it could have the CDN cache one page's HTML under another URL.
  if (ctx.request.headers.has('x-astro-path')) {
    return new Response('Bad request', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const { pathname } = ctx.url;
  if (ctx.isPrerendered) return isPageOn(pathname) ? next() : notFound();
  const { adminPath, adminUsers } = adminSettings();
  const api = pathname === '/api/admin' || pathname.startsWith('/api/admin/');
  const page = pathname === `/${adminPath}` || pathname.startsWith(`/${adminPath}/`);
  if (!api && !page) {
    const cacheable = ctx.request.method === 'GET' || ctx.request.method === 'HEAD';
    if (getMode() === 'postgres') return cacheable ? publicPage(pathname, next) : next();
    return isPageOn(pathname) ? next() : notFound();
  }

  let res: Response;
  if (api && MUTATING.has(ctx.request.method) && ctx.request.headers.get('origin') !== ctx.url.origin) {
    res = jsonError(403, 'Cross-origin request refused');
  } else if (
    pathname.startsWith('/api/admin/auth/') ||
    pathname.startsWith('/api/admin/cron/') ||
    pathname === `/${adminPath}/login`
  ) {
    res = await next();
  } else {
    const token = ctx.cookies.get(SESSION_COOKIE)?.value;
    const user = token ? await openSession(token, sessionSecret()) : null;
    let allowed = false;
    let down: Response | undefined;
    try {
      allowed = !!user && (await isAllowed(user, adminUsers));
    } catch (e) {
      if (!isUnreachable(e)) throw e;
      // eslint-disable-next-line no-console
      console.error('[middleware] database unreachable while checking a password session', e);
      down = api ? jsonError(503, 'The database is unreachable. Try again in a moment.') : unavailable();
    }
    if (down) {
      res = down;
    } else if (user && allowed) {
      ctx.locals.user = user;
      res = await next();
    } else {
      res = api ? jsonError(401, 'Not signed in') : ctx.redirect(`/${adminPath}/login`);
    }
  }
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Robots-Tag', 'noindex');
  return out;
};
