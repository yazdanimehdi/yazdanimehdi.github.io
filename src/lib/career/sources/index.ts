import type { TextInput } from '../../ai/providers';
import type { SecretName } from '../../admin/secrets';
import type { CareerPrefs } from '../settings';
import type { RawPosting } from '../types';
import { adzuna } from './adzuna';
import { watched } from './ats';
import { arbeitnow } from './arbeitnow';
import { careersPage } from './careers-page';
import { googleJobs } from './google-jobs';
import { linkedin } from './linkedin';
import { remoteok } from './remoteok';
import { remotive } from './remotive';
import { rss } from './rss';
import { usajobs } from './usajobs';

export interface SourceContext {
  prefs: CareerPrefs;
  secret(name: SecretName): Promise<string | undefined>;
  siteUrl: string;
  ai(input: TextInput): Promise<string>;
}

export interface Source {
  id: string;
  label: string;
  /** A missing key means `skipped: no <NAME>`, not a failure. */
  needs?: SecretName[];
  defaultOn: boolean;
  warning?: string;
  search(ctx: SourceContext): Promise<RawPosting[]>;
  detail?(p: RawPosting, ctx: SourceContext): Promise<Pick<RawPosting, 'description' | 'format'>>;
}

/** Adding a source means one file plus one line here. */
export const SOURCES: Record<string, Source> = {
  watched,
  'careers-page': careersPage,
  remotive,
  remoteok,
  arbeitnow,
  adzuna,
  usajobs,
  'google-jobs': googleJobs,
  rss,
  linkedin,
};
