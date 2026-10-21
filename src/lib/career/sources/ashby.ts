import type { RawPosting } from '../types';
import { getJson, type FetchInit } from './http';

interface Job {
  id: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  location?: string;
  isRemote?: boolean | null;
  publishedAt?: string;
  descriptionHtml: string;
  compensation?: {
    summaryComponents?: {
      compensationType: string;
      interval?: string;
      currencyCode?: string;
      minValue?: number | null;
      maxValue?: number | null;
    }[];
  };
}

const PERIODS = { '1 YEAR': 'year', '1 MONTH': 'month', '1 HOUR': 'hour' } as const;

function salary(job: Job): RawPosting['salary'] {
  const c = job.compensation?.summaryComponents?.find((s) => s.compensationType === 'Salary');
  if (!c) return undefined;
  return {
    min: c.minValue ?? undefined,
    max: c.maxValue ?? undefined,
    currency: c.currencyCode,
    period: PERIODS[c.interval as keyof typeof PERIODS],
  };
}

/** Ashby has no company name; the board token stands in. */
export async function ashby(token: string, init?: FetchInit): Promise<RawPosting[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
  const { jobs } = (await getJson(url, init)) as { jobs: Job[] };
  return jobs.map((j) => ({
    source: 'ashby',
    externalId: j.id,
    company: token,
    title: j.title,
    location: j.location,
    remote: j.isRemote ?? undefined,
    url: j.jobUrl,
    applyUrl: j.applyUrl,
    description: j.descriptionHtml,
    format: 'html',
    postedAt: j.publishedAt,
    salary: salary(j),
  }));
}
