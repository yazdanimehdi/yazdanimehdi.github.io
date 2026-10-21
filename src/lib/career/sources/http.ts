import { BlockList, isIP } from 'node:net';

export class SourceError extends Error {}

export interface FetchInit {
  headers?: Record<string, string>;
  /** Names the site in the User-Agent. */
  siteUrl?: string;
  /** Body cap; 5 MB unless raised. */
  maxBytes?: number;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked against the IPv4 rules by BlockList itself.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16],
  ['0.0.0.0', 8],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4');
// ::/96 holds ::, ::1, and IPv4-compatible addresses; 64:ff9b::/96 is NAT64.
PRIVATE.addSubnet('::', 96, 'ipv6');
PRIVATE.addSubnet('64:ff9b::', 96, 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

/** Throws unless `url` is http(s) on a public host. DNS names are not resolved (accepted gap). */
function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SourceError(`Refused ${url.protocol} URL`);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const ip = isIP(host);
  if (host === 'localhost' || host.endsWith('.localhost') || (ip && PRIVATE.check(host, ip === 6 ? 'ipv6' : 'ipv4')))
    throw new SourceError(`Refused private host ${url.hostname}`);
}

function toUrl(href: string, base?: URL): URL {
  try {
    return new URL(href, base);
  } catch {
    throw new SourceError(`Not a URL: ${href}`);
  }
}

async function readCapped(res: Response, host: string, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new SourceError(`${host}: response is over ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Lets the connection go without reading the body. */
const discard = (res: Response) => void res.body?.cancel().catch(() => {});

/** Network and timeout errors become SourceErrors; SourceErrors pass through. */
const fail = (url: URL) => (e: unknown) => {
  throw e instanceof SourceError ? e : new SourceError(`${url.host}: ${(e as Error).message}`);
};

/** GET with the job-search User-Agent, a 15 s timeout, checked redirects, and a body cap (`init.maxBytes`, 5 MB by default). */
export async function getText(url: string, init: FetchInit = {}): Promise<string> {
  const signal = AbortSignal.timeout(15_000);
  let headers: Record<string, string> = {
    'User-Agent': init.siteUrl ? `ScholarOS job search (+${init.siteUrl})` : 'ScholarOS job search',
    ...init.headers,
  };
  let current = toUrl(url);
  const origin = current.origin;
  for (let hop = 0; ; hop++) {
    assertPublic(current);
    // Off the original origin, caller headers (keys, tokens) are dropped for this hop and every later one.
    if (current.origin !== origin)
      headers = Object.fromEntries(
        Object.entries(headers).filter(([k]) => ['user-agent', 'accept'].includes(k.toLowerCase())),
      );
    const res = await fetch(current.href, { headers, redirect: 'manual', signal }).catch(fail(current));
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      discard(res);
      if (hop >= MAX_REDIRECTS) throw new SourceError(`${url}: more than ${MAX_REDIRECTS} redirects`);
      current = toUrl(location, current);
      continue;
    }
    if (!res.ok) {
      discard(res);
      throw new SourceError(`${current.host} answered ${res.status}`);
    }
    return readCapped(res, current.host, init.maxBytes ?? MAX_BYTES).catch(fail(current));
  }
}

export async function getJson(url: string, init: FetchInit = {}): Promise<unknown> {
  const text = await getText(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError(`${url} did not answer JSON`);
  }
}
