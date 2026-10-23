import { sleep } from 'workflow';
import { fetchTextStep, reserveArxiv, textNeed } from '../lib/reading/room-steps';

/**
 * Fetches the papers' missing texts, inside a workflow: each fetch waits for its arXiv slot, and a paper follows
 * `next` (HTML, then PDF), so each source is tried at most once per run. `fetched`: papers that ended with their text;
 * `failed`: papers left with a retryable error.
 */
export async function ensureTexts(paperIds: number[]): Promise<{ fetched: number; failed: number }> {
  let fetched = 0;
  let failed = 0;
  for (const id of paperIds) {
    try {
      let step = await textNeed(id);
      if (!step) continue;
      let ok = false;
      while (step) {
        const wait = await reserveArxiv();
        if (wait) await sleep(wait);
        ({ next: step, ok } = await fetchTextStep(id, step));
      }
      if (ok) fetched++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { fetched, failed };
}
