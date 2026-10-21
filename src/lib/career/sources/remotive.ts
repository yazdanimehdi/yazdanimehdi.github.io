import type { Source } from './index';
import { fetchInit, MAX_POSTINGS, queryOf } from './query';
import { getJson } from './http';

interface Job {
  id: number;
  url: string;
  title: string;
  company_name: string;
  publication_date?: string;
  candidate_required_location?: string;
  description: string;
}

export const remotive: Source = {
  id: 'remotive',
  label: 'Remotive',
  defaultOn: true,
  async search(ctx) {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(queryOf(ctx.prefs))}&limit=${MAX_POSTINGS}`;
    const { jobs } = (await getJson(url, fetchInit(ctx))) as { jobs: Job[] };
    return jobs.slice(0, MAX_POSTINGS).map((j) => ({
      source: 'remotive',
      externalId: String(j.id),
      company: j.company_name,
      title: j.title,
      location: j.candidate_required_location,
      remote: true,
      url: j.url,
      description: j.description,
      format: 'html',
      postedAt: j.publication_date,
    }));
  },
};
