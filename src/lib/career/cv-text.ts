// The owner's CV read for the AI. Kept out of steps.ts: a 'use step' module's exported non-step functions stay in the
// workflow bundle with their imports, and these pull in the store and Postgres.
import { readConfig } from '../admin/content';
import type { PostgresStore } from '../admin/postgres-store';
import { resolveCvConfig } from '../cv';
import type { CvConfig } from '../types';
import { cvText } from './profile';

/** The CV read through the store as cv-render does (an enabled upload wins); `cv` is missing when there is none. */
export async function readCv(store: PostgresStore): Promise<CvConfig> {
  const [cv, upload] = await Promise.all([readConfig(store, 'cv'), readConfig(store, 'cv-upload')]);
  return resolveCvConfig(upload.data as { enabled?: boolean; content?: string }, () => cv.data as unknown as CvConfig);
}

/** The CV as prompt text; '' when there is none. */
export async function cvTextOf(store: PostgresStore): Promise<string> {
  const resolved = await readCv(store);
  return resolved?.cv ? cvText(resolved).trim() : '';
}
