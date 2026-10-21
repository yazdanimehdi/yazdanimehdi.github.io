import type { RawPosting } from '../types';
import { getJson, type FetchInit } from './http';

interface Job {
  id: number;
  title: string;
  absolute_url: string;
  company_name: string;
  location?: { name?: string };
  first_published?: string;
  /** HTML, HTML-escaped once more. */
  content: string;
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
const unescape = (s: string) => s.replace(/&(?:lt|gt|quot|#39|amp);/g, (m) => ENTITIES[m]);

export async function greenhouse(token: string, init?: FetchInit): Promise<RawPosting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const { jobs } = (await getJson(url, init)) as { jobs: Job[] };
  return jobs.map((j) => ({
    source: 'greenhouse',
    externalId: String(j.id),
    company: j.company_name,
    title: j.title,
    location: j.location?.name,
    url: j.absolute_url,
    description: unescape(j.content),
    format: 'html',
    postedAt: j.first_published,
    ats: { kind: 'greenhouse', board: token, id: String(j.id) },
  }));
}
