import type { RawPosting } from '../types';
import type { Source } from './index';
import { fetchInit, locationsOf, MAX_POSTINGS, queryOf, requireSecret, scrubbed } from './query';
import { getJson, SourceError } from './http';

interface Job {
  title: string;
  company_name: string;
  location?: string;
  description: string;
  apply_options?: { link: string }[];
  share_link?: string;
  detected_extensions?: { work_from_home?: boolean };
  job_id: string;
}

interface Page {
  error?: string;
  jobs_results?: Job[];
  serpapi_pagination?: { next_page_token?: string };
}

// Cost ceiling: one SerpAPI credit per page, at most 2 pages x 3 locations = 6 credits a night, the same key as the papers sync.
const PAGES = 2;

export const googleJobs: Source = {
  id: 'google-jobs',
  label: 'Google Jobs',
  needs: ['SERPAPI_KEY'],
  defaultOn: true,
  async search(ctx) {
    const key = await requireSecret(ctx, 'SERPAPI_KEY');
    const seen = new Map<string, RawPosting>();
    for (const location of locationsOf(ctx.prefs)) {
      let token: string | undefined;
      for (let page = 0; page < PAGES; page++) {
        const params = new URLSearchParams({ engine: 'google_jobs', q: queryOf(ctx.prefs) });
        if (location) params.set('location', location);
        if (token) params.set('next_page_token', token);
        params.set('api_key', key);
        const res = (await scrubbed([key], () =>
          getJson(`https://serpapi.com/search.json?${params}`, fetchInit(ctx)),
        )) as Page;
        // SerpAPI answers 200 with `error` when a query has no results.
        if (res.error && !res.jobs_results && !/hasn't returned any results/i.test(res.error))
          throw new SourceError(res.error);
        for (const j of res.jobs_results ?? []) {
          const url = j.apply_options?.[0]?.link ?? j.share_link;
          if (url && !seen.has(j.job_id))
            seen.set(j.job_id, {
              source: 'google-jobs',
              externalId: j.job_id,
              company: j.company_name,
              title: j.title,
              location: j.location,
              remote: j.detected_extensions?.work_from_home,
              url,
              description: j.description,
              format: 'text',
            });
        }
        token = res.serpapi_pagination?.next_page_token;
        if (!token) break;
      }
    }
    return [...seen.values()].slice(0, MAX_POSTINGS);
  },
};
