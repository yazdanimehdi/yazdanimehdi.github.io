import Parser from 'rss-parser';
import type { RawPosting } from '../types';
import type { Source } from './index';
import { fetchInit, MAX_POSTINGS } from './query';
import { getText, SourceError } from './http';

/** Academic feeds whose URL returned items when last checked. The settings screen offers these. */
export const SUGGESTED_FEEDS: { label: string; url: string }[] = [
  { label: 'HigherEdJobs: Chemistry', url: 'https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=101' },
  {
    label: 'HigherEdJobs: Geology, Earth Sciences, and Oceanography',
    url: 'https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=170',
  },
];

const isHttp = (href: string) => {
  try {
    return /^https?:$/.test(new URL(href).protocol);
  } catch {
    return false;
  }
};

export const rss: Source = {
  id: 'rss',
  label: 'RSS feeds',
  defaultOn: true,
  async search(ctx) {
    const parser = new Parser();
    const out: RawPosting[] = [];
    const failed: string[] = [];
    // One at a time; `getText` keeps feeds behind the same fetch-safety rules as every other source.
    for (const url of ctx.prefs.feeds) {
      try {
        const feed = await parser.parseString(await getText(url, fetchInit(ctx)));
        for (const item of feed.items) {
          const link = item.link?.trim();
          if (!item.title || !link || !isHttp(link)) continue;
          const description = item.content ?? item.contentSnippet ?? '';
          out.push({
            source: 'rss',
            externalId: item.guid ?? link,
            company: feed.title ?? '',
            title: item.title,
            url: link,
            description,
            format: /<[a-z][^>]*>/i.test(description) ? 'html' : 'text',
            postedAt: item.isoDate,
          });
        }
      } catch (e) {
        failed.push(`${url}: ${(e as Error).message}`);
      }
    }
    if (failed.length && failed.length === ctx.prefs.feeds.length) throw new SourceError(failed.join('; '));
    return out.slice(0, MAX_POSTINGS);
  },
};
