import type { Source } from './index';
import { fromGoogleJob, searchGoogleJobs } from './google-jobs';
import { MAX_POSTINGS } from './query';

// LinkedIn's robots.txt disallows everything (`/jobs-guest/` even for Googlebot), so this never fetches linkedin.com:
// it keeps the Google Jobs results that LinkedIn lists, as Google already indexes them. One page per location keeps it
// to 3 extra SerpAPI credits a run.
const PAGES = 1;

const isLinkedIn = (link: string) => {
  try {
    return /(^|\.)linkedin\.com$/.test(new URL(link).hostname);
  } catch {
    return false;
  }
};

export const linkedin: Source = {
  id: 'linkedin',
  label: 'LinkedIn (via Google Jobs)',
  needs: ['SERPAPI_KEY'],
  defaultOn: false,
  warning:
    "Finds LinkedIn's listings through Google Jobs (SerpAPI) and never contacts LinkedIn. Up to 3 more SerpAPI credits a run, from the same key as Google Jobs.",
  async search(ctx) {
    return (await searchGoogleJobs(ctx, PAGES))
      .flatMap((j) => {
        const link = j.apply_options?.find((o) => isLinkedIn(o.link))?.link;
        return link ? [fromGoogleJob(j, 'linkedin', link)] : [];
      })
      .slice(0, MAX_POSTINGS);
  },
};
