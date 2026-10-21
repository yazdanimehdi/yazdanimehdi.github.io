import type { RawPosting } from '../types';
import { getJson, type FetchInit } from './http';

interface Listed {
  id: string;
  name: string;
  company: { name: string };
  releasedDate?: string;
  location?: { fullLocation?: string; remote?: boolean };
}

const api = (token: string) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings`;

/** The list carries no description; `smartrecruitersDetail` fetches it. */
export async function smartrecruiters(token: string, init?: FetchInit): Promise<RawPosting[]> {
  // ponytail: first page only (the API's default 100); page by `offset` if a watched company posts more.
  const { content } = (await getJson(api(token), init)) as { content: Listed[] };
  return content.map((p) => ({
    source: 'smartrecruiters',
    externalId: p.id,
    company: p.company.name,
    title: p.name,
    location: p.location?.fullLocation,
    remote: p.location?.remote,
    url: `https://jobs.smartrecruiters.com/${token}/${p.id}`,
    description: '',
    format: 'html',
    postedAt: p.releasedDate,
  }));
}

export async function smartrecruitersDetail(
  token: string,
  id: string,
  init?: FetchInit,
): Promise<Pick<RawPosting, 'description' | 'format'>> {
  const { jobAd } = (await getJson(`${api(token)}/${encodeURIComponent(id)}`, init)) as {
    jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
  };
  const description = Object.values(jobAd?.sections ?? {})
    .filter((s) => s.text)
    .map((s) => `<h2>${s.title ?? ''}</h2>${s.text}`)
    .join('');
  return { description, format: 'html' };
}
