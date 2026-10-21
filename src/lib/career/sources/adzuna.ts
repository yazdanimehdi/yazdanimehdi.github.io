import type { RawPosting } from '../types';
import type { Source } from './index';
import { fetchInit, locationsOf, MAX_POSTINGS, queryOf, requireSecret, scrubbed } from './query';
import { getJson } from './http';

interface Job {
  id: string;
  title: string;
  description: string;
  created?: string;
  redirect_url: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
}

export const adzuna: Source = {
  id: 'adzuna',
  label: 'Adzuna',
  needs: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  defaultOn: false,
  async search(ctx) {
    const id = await requireSecret(ctx, 'ADZUNA_APP_ID');
    const key = await requireSecret(ctx, 'ADZUNA_APP_KEY');
    const country = encodeURIComponent((ctx.prefs.sources.adzuna?.options?.country || 'us').toLowerCase());
    const out: RawPosting[] = [];
    for (const where of locationsOf(ctx.prefs)) {
      const params = new URLSearchParams({ app_id: id, app_key: key, what: queryOf(ctx.prefs) });
      if (where) params.set('where', where);
      params.set('results_per_page', '50');
      const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`;
      const { results } = await scrubbed([id, key], () => getJson(url, fetchInit(ctx)) as Promise<{ results: Job[] }>);
      for (const j of results)
        out.push({
          source: 'adzuna',
          externalId: String(j.id),
          company: j.company?.display_name ?? '',
          title: j.title,
          location: j.location?.display_name,
          url: j.redirect_url,
          // A snippet, not the full ad.
          description: j.description,
          format: 'text',
          postedAt: j.created,
          salary:
            j.salary_is_predicted === '0' && (j.salary_min || j.salary_max)
              ? { min: j.salary_min, max: j.salary_max, period: 'year' }
              : undefined,
        });
    }
    return out.slice(0, MAX_POSTINGS);
  },
};
