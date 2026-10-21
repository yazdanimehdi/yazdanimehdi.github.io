import type { RawPosting } from '../types';
import { getJson, type FetchInit } from './http';

interface Account {
  name: string;
  jobs: {
    shortcode: string;
    title: string;
    url: string;
    application_url?: string;
    telecommuting?: boolean;
    city?: string;
    state?: string;
    country?: string;
    published_on?: string;
    description?: string;
  }[];
}

/** `details=true` is what adds `description`. */
export async function workable(token: string, init?: FetchInit): Promise<RawPosting[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`;
  const { name, jobs } = (await getJson(url, init)) as Account;
  return jobs.map((j) => ({
    source: 'workable',
    externalId: j.shortcode,
    company: name,
    title: j.title,
    location: [j.city, j.state, j.country].filter(Boolean).join(', ') || undefined,
    remote: j.telecommuting,
    url: j.url,
    applyUrl: j.application_url,
    description: j.description ?? '',
    format: 'html',
    postedAt: j.published_on,
  }));
}
