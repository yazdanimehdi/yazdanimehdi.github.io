import type { RawPosting } from '../types';
import type { Source, SourceContext } from './index';
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

/** Google Jobs results for the prefs' query, up to `pages` pages per location, one per `job_id`. */
export async function searchGoogleJobs(ctx: SourceContext, pages: number): Promise<Job[]> {
  // An empty query would be an unbounded (or paid) search for nothing.
  if (!queryOf(ctx.prefs).trim()) return [];
  const key = await requireSecret(ctx, 'SERPAPI_KEY');
  const seen = new Map<string, Job>();
  for (const location of locationsOf(ctx.prefs)) {
    let token: string | undefined;
    for (let page = 0; page < pages; page++) {
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
      for (const j of res.jobs_results ?? []) if (!seen.has(j.job_id)) seen.set(j.job_id, j);
      token = res.serpapi_pagination?.next_page_token;
      if (!token) break;
    }
  }
  return [...seen.values()];
}

/** A Google Jobs result as a posting from `source`, linking to `url`. */
export const fromGoogleJob = (j: Job, source: string, url: string): RawPosting => ({
  source,
  externalId: j.job_id,
  company: j.company_name,
  title: j.title,
  location: j.location,
  remote: j.detected_extensions?.work_from_home,
  url,
  description: j.description,
  format: 'text',
});

export const googleJobs: Source = {
  id: 'google-jobs',
  label: 'Google Jobs',
  needs: ['SERPAPI_KEY'],
  defaultOn: true,
  async search(ctx) {
    return (await searchGoogleJobs(ctx, PAGES))
      .flatMap((j) => {
        const url = j.apply_options?.[0]?.link ?? j.share_link;
        return url ? [fromGoogleJob(j, 'google-jobs', url)] : [];
      })
      .slice(0, MAX_POSTINGS);
  },
};
