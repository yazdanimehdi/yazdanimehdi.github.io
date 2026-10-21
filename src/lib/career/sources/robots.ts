// Ported from ai-job-search tools/robots_check.py (MIT, (c) 2026 Mads Lorentzen).
// RFC 9309, on the cautious side: longest match wins, an equal-length tie goes to Disallow,
// and only a 404 means "no policy". Any other failure to read robots.txt refuses the fetch.
import { getText, SourceError, type FetchInit } from './http';

const RULE_FIELDS = ['user-agent', 'allow', 'disallow'];

const lines = (text: string) => text.replace(/^\ufeff/, '').split(/\r\n|\r|\n/);

/** Percent-decodes what decodes and leaves malformed escapes as they are, as Python's `unquote` does. */
const unquote = (s: string) =>
  s.replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });

/** A misconfigured host can answer 200 with an HTML page; that is not permission. Empty is a valid allow-all. */
export function isRobotsBody(text: string): boolean {
  if (!text.replace(/^\ufeff/, '').trim()) return true;
  return lines(text).some((raw) => {
    const line = raw.split('#')[0].trim().toLowerCase();
    const i = line.indexOf(':');
    return i >= 0 && [...RULE_FIELDS, 'sitemap', 'crawl-delay', 'host'].includes(line.slice(0, i).trim());
  });
}

/** A rule line holding U+FFFD (a byte that was not UTF-8) can never match, so the file is unreadable, not permissive. */
export function hasUndecodableRule(text: string): boolean {
  return lines(text).some((raw) => {
    const line = raw.split('#')[0];
    const i = line.indexOf(':');
    return (
      line.includes('\ufffd') &&
      i >= 0 &&
      RULE_FIELDS.includes(line.slice(0, i).replaceAll('\ufffd', '').trim().toLowerCase())
    );
  });
}

/** user-agent -> [allow?, pattern][]; blank lines inside a record do not end it. */
function groups(text: string): Map<string, [boolean, string][]> {
  const out = new Map<string, [boolean, string][]>();
  let agents: string[] = [];
  let expectAgent = true;
  for (const raw of lines(text)) {
    const line = raw.split('#')[0].trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'user-agent') {
      if (!expectAgent) [agents, expectAgent] = [[], true];
      agents.push(value.toLowerCase());
      if (!out.has(value.toLowerCase())) out.set(value.toLowerCase(), []);
    } else if ((field === 'allow' || field === 'disallow') && agents.length) {
      expectAgent = false;
      for (const a of agents) out.get(a)!.push([field === 'allow', value]);
    }
  }
  return out;
}

/** Match length, or -1. `*` is any run; `$` anchors only at the end of the pattern. */
function match(pattern: string, path: string): number {
  if (!pattern) return -1;
  const decoded = unquote(pattern);
  const anchored = decoded.endsWith('$');
  const body = anchored ? decoded.slice(0, -1) : decoded;
  const rx = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${rx}${anchored ? '$' : ''}`, 's').test(path) ? decoded.length : -1;
}

/** Whether `agent` (else `*`) may fetch `url` under this robots.txt. */
export function robotsAllows(robotsTxt: string, url: string, agent = 'ScholarOS'): boolean {
  const u = new URL(url);
  const path = unquote(u.pathname) + (u.search ? `?${unquote(u.search.slice(1))}` : '');
  const g = groups(robotsTxt);
  const rules = g.get(agent.toLowerCase()) ?? g.get('*') ?? [];
  let bestLen = -1;
  let bestAllow = true;
  for (const [allow, pattern] of rules) {
    const n = match(pattern, path);
    if (n > bestLen || (n === bestLen && n >= 0 && !allow)) [bestLen, bestAllow] = [n, allow];
  }
  return bestLen < 0 || bestAllow;
}

/** Per origin: the robots.txt body, or null for a 404. A rejection means unconfirmed. */
const cache = new Map<string, Promise<string | null>>();

export function clearRobotsCache(): void {
  cache.clear();
}

function robotsFor(origin: URL, init?: FetchInit): Promise<string | null> {
  let body = cache.get(origin.origin);
  if (!body) {
    const unconfirmed = new SourceError(`robots.txt unconfirmed for ${origin.host}`);
    body = getText(`${origin.origin}/robots.txt`, init).then(
      (text) => {
        if (!isRobotsBody(text) || hasUndecodableRule(text)) throw unconfirmed;
        return text;
      },
      (e) => {
        if (e instanceof SourceError && e.status === 404) return null;
        throw unconfirmed;
      },
    );
    cache.set(origin.origin, body);
  }
  return body;
}

/** GETs `url` when its host's robots.txt (read once per host per process) allows it. */
export async function fetchAllowed(url: string, init?: FetchInit): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SourceError(`Not a URL: ${url.split('?')[0]}`);
  }
  const robots = await robotsFor(u, init);
  if (robots !== null && !robotsAllows(robots, url)) throw new SourceError(`robots.txt disallows ${url}`);
  return getText(url, init);
}
