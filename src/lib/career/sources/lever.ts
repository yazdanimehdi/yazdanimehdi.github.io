import type { RawPosting } from '../types';
import { getJson, type FetchInit } from './http';

interface Job {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string };
  description?: string;
  lists?: { text: string; content: string }[];
  additional?: string;
}

/** Lever has no company name; the board token stands in. */
export async function lever(token: string, init?: FetchInit): Promise<RawPosting[]> {
  const jobs = (await getJson(
    `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
    init,
  )) as Job[];
  return jobs.map((j) => ({
    source: 'lever',
    externalId: j.id,
    company: token,
    title: j.text,
    location: j.categories?.location,
    remote: j.workplaceType ? j.workplaceType === 'remote' : undefined,
    url: j.hostedUrl,
    applyUrl: j.applyUrl,
    description: [
      j.description ?? '',
      ...(j.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`),
      j.additional ?? '',
    ].join(''),
    format: 'html',
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
  }));
}
