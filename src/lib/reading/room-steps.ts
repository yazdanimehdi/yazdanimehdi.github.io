// The reading room's steps. Each has maxRetries = 0, so a retry never skips arXiv's crawl delay.
import { getSql } from '../db';
import { reserveArxivSlot } from './room-db';
import { fetchArxivText, textNeedFor, type TextStep } from './fetch-text';

export async function textNeed(paperId: number): Promise<TextStep | null> {
  'use step';
  return textNeedFor(getSql(), paperId);
}
textNeed.maxRetries = 0;

/** How long to wait (ms) for the next site-wide arXiv slot, which is now this run's. */
export async function reserveArxiv(): Promise<number> {
  'use step';
  return reserveArxivSlot(getSql());
}
reserveArxiv.maxRetries = 0;

export async function fetchTextStep(paperId: number, step: TextStep): Promise<{ next: TextStep | null; ok: boolean }> {
  'use step';
  return fetchArxivText(getSql(), paperId, step);
}
fetchTextStep.maxRetries = 0;
