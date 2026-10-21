import { isIP } from 'node:net';
import type { Nodes } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { visit } from 'unist-util-visit';
import { guardPosting } from '../guard';
import { extractPrompt, parseExtract } from '../prompts';
import type { RawPosting } from '../types';
import { detectAts } from './ats';
import { SourceError } from './http';
import type { Source, SourceContext } from './index';
import { fetchInit, MAX_POSTINGS } from './query';
import { fetchAllowed } from './robots';

const SECOND_LEVEL = new Set(['co', 'com', 'ac', 'org', 'net', 'gov', 'edu', 'ne', 'or']);

/** The registrable site of a host: `jobs.acme.co.uk` -> `acme.co.uk`. IP hosts are their own site. */
// ponytail: not the public-suffix list, so acme.github.io and evil.github.io read as one site; use tldts if that matters.
export function siteOf(host: string): string {
  const h = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  if (isIP(h)) return h;
  const labels = h.split('.');
  const three = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!);
  return labels.slice(three ? -3 : -2).join('.');
}

export const textOf = (n: Nodes): string =>
  n.type === 'text' ? n.value : 'children' in n ? n.children.map(textOf).join('') : '';

const fold = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The page's same-site links, one `text (url)` per line, so the model can name real URLs.
 * Link text the guard did not keep as visible (hidden anchors) is left out.
 */
function linksOf(html: string, pageUrl: string, visible: string): string {
  const site = siteOf(new URL(pageUrl).hostname);
  const links = new Map<string, string>();
  visit(fromHtml(html), 'element', (el) => {
    if (el.tagName !== 'a' || typeof el.properties.href !== 'string') return;
    let u: URL;
    try {
      u = new URL(el.properties.href, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || siteOf(u.hostname) !== site) return;
    u.hash = '';
    const text = fold(textOf(el));
    if (!links.has(u.href)) links.set(u.href, text && visible.includes(text) ? `${text} (${u.href})` : u.href);
  });
  return guardPosting([...links.values()].join('\n'), 'text').text;
}

const companyOf = (host: string) =>
  siteOf(host)
    .split('.')[0]
    .replace(/\b\w/g, (c) => c.toUpperCase());

async function pagePostings(pageUrl: string, ctx: SourceContext): Promise<RawPosting[]> {
  const html = await fetchAllowed(pageUrl, fetchInit(ctx));
  let text: string;
  try {
    text = guardPosting(html, 'html').text;
  } catch (e) {
    throw new SourceError(`${pageUrl}: ${(e as Error).message}`);
  }
  // Links first: the 20,000-character cap trims the page text before them.
  const reply = await ctx.ai(extractPrompt(`Links:\n${linksOf(html, pageUrl, text)}\n\nPage:\n${text}`, pageUrl));
  const site = siteOf(new URL(pageUrl).hostname);
  return parseExtract(reply, pageUrl)
    .filter((p) => siteOf(new URL(p.url).hostname) === site)
    .map((p) => ({
      source: 'careers-page',
      externalId: p.url,
      company: companyOf(new URL(pageUrl).hostname),
      title: p.title,
      location: p.location,
      url: p.url,
      description: '',
      format: 'text',
    }));
}

/** Watched companies whose careers page is the company's own site, not a known board. */
export const careersPage: Source = {
  id: 'careers-page',
  label: 'Company careers pages',
  defaultOn: true,
  async search(ctx) {
    const urls = ctx.prefs.watched.filter((u) => !detectAts(u));
    const out: RawPosting[] = [];
    const failed: string[] = [];
    // One page at a time: each costs an AI call.
    for (const url of urls) {
      try {
        out.push(...(await pagePostings(url, ctx)));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    if (failed.length && failed.length === urls.length) throw new SourceError(failed.join('; '));
    return out.slice(0, MAX_POSTINGS);
  },
  // The runner guards the description before scoring or storage.
  async detail(p, ctx) {
    return { description: await fetchAllowed(p.url, fetchInit(ctx)), format: 'html' };
  },
};
