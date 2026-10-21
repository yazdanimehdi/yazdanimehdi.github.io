import type { Source } from './index';
import { fetchInit, matching, MAX_POSTINGS } from './query';
import { getJson } from './http';

interface Job {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote?: boolean;
  url: string;
  tags?: string[];
  location?: string;
  created_at?: number;
}

export const arbeitnow: Source = {
  id: 'arbeitnow',
  label: 'Arbeitnow',
  defaultOn: true,
  async search(ctx) {
    // ponytail: first page only (100 newest, no search parameter); follow `links.next` if that proves too shallow.
    const { data } = (await getJson('https://www.arbeitnow.com/api/job-board-api', fetchInit(ctx))) as { data: Job[] };
    return matching(ctx.prefs, data, (j) => `${j.title} ${(j.tags ?? []).join(' ')}`)
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        source: 'arbeitnow',
        externalId: j.slug,
        company: j.company_name,
        title: j.title,
        location: j.location,
        remote: j.remote,
        url: j.url,
        description: j.description,
        format: 'html',
        postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
      }));
  },
};
