import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';

export class SourceError extends Error {
  /** The HTTP status, when the error is a non-2xx answer. */
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

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
  ['100.64.0.0', 10], // carrier-grade NAT
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4');
// ::/96 holds ::, ::1, and IPv4-compatible addresses; 64:ff9b::/96 is NAT64.
PRIVATE.addSubnet('::', 96, 'ipv6');
PRIVATE.addSubnet('64:ff9b::', 96, 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
const dnsLookup: Lookup = (host) => dns.lookup(host, { all: true, verbatim: true });
let lookup = dnsLookup;

/** Tests resolve names through `fn`, never real DNS; null restores it. */
export function setLookupForTests(fn: Lookup | null): void {
  lookup = fn ?? dnsLookup;
}

const isPrivate = (address: string, family: number) => PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4');

/** Where a URL points, for messages: host and path, never the query (it can hold keys). */
const where = (url: URL) => url.host + url.pathname;

/** Throws unless `url` is http(s) on a public host; a DNS name must resolve only to public addresses. */
async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SourceError(`Refused ${url.protocol} URL`);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const ip = isIP(host);
  const refused = new SourceError(`Refused private host ${url.hostname}`);
  if (host === 'localhost' || host.endsWith('.localhost') || (ip && isPrivate(host, ip))) throw refused;
  if (ip) return;
  // ponytail: fetch resolves the name again, so a rebinding DNS server can still answer differently in between; pin the address with an undici dispatcher if that matters.
  const addresses = await lookup(host).catch((e: Error) => {
    throw new SourceError(`${url.host}: ${e.message}`);
  });
  if (addresses.some((a) => isPrivate(a.address, a.family))) throw refused;
}

function toUrl(href: string, base?: URL): URL {
  try {
    return new URL(href, base);
  } catch {
    throw new SourceError(`Not a URL: ${href.split('?')[0]}`);
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
    await assertPublic(current);
    // Off the original origin, caller headers (keys, tokens) are dropped for this hop and every later one.
    if (current.origin !== origin)
      headers = Object.fromEntries(
        Object.entries(headers).filter(([k]) => ['user-agent', 'accept'].includes(k.toLowerCase())),
      );
    const res = await fetch(current.href, { headers, redirect: 'manual', signal }).catch(fail(current));
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      discard(res);
      if (hop >= MAX_REDIRECTS) throw new SourceError(`${where(current)}: more than ${MAX_REDIRECTS} redirects`);
      current = toUrl(location, current);
      continue;
    }
    if (!res.ok) {
      discard(res);
      throw new SourceError(`${current.host} answered ${res.status}`, res.status);
    }
    return readCapped(res, current.host, init.maxBytes ?? MAX_BYTES).catch(fail(current));
  }
}

export async function getJson(url: string, init: FetchInit = {}): Promise<unknown> {
  const text = await getText(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError(`${where(toUrl(url))} did not answer JSON`);
  }
}
