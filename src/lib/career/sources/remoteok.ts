import type { Source } from './index';
import { fetchInit, matching, MAX_POSTINGS } from './query';
import { getJson } from './http';

interface Job {
  id?: string;
  url: string;
  apply_url?: string;
  position: string;
  company: string;
  location?: string;
  tags?: string[];
  description: string;
  date?: string;
  salary_min?: number;
  salary_max?: number;
}

export const remoteok: Source = {
  id: 'remoteok',
  label: 'Remote OK',
  defaultOn: true,
  async search(ctx) {
    // The first element is the legal notice (no id); the terms require linking back to remoteok.com, which `url` does.
    const jobs = ((await getJson('https://remoteok.com/api', fetchInit(ctx))) as Job[]).filter((j) => j.id);
    return matching(ctx.prefs, jobs, (j) => `${j.position} ${(j.tags ?? []).join(' ')}`)
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        source: 'remoteok',
        externalId: j.id!,
        company: j.company,
        title: j.position,
        location: j.location || undefined,
        remote: true,
        url: j.url,
        applyUrl: j.apply_url && j.apply_url !== j.url ? j.apply_url : undefined,
        description: j.description,
        format: 'html',
        postedAt: j.date,
        salary:
          j.salary_min || j.salary_max
            ? { min: j.salary_min, max: j.salary_max, currency: 'USD', period: 'year' }
            : undefined,
      }));
  },
};
