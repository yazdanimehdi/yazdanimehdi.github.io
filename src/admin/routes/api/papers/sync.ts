import { json, route } from '../../../../lib/admin/http';
import { papersDeps, syncPapers } from '../../../../lib/admin/papers';
import { SCHOLAR_JSON } from '../../../../lib/admin/paths';
import { missingKey } from '../../../../lib/admin/secrets';

export const prerender = false;

/** The last sync that found something (scholar.json), for the AI screen. */
export const GET = route(async (_ctx, store) => {
  const file = await store.read(SCHOLAR_JSON);
  let lastRun: string | null = null;
  try {
    const at = JSON.parse(file?.content ?? 'null')?.lastRun;
    if (typeof at === 'string') lastRun = at;
  } catch {
    // a hand-broken file: no date to show
  }
  return json({ lastRun });
});

/** "Check now" on the AI screen, both modes: new Scholar papers become publications and draft posts. */
export const POST = route(async (_ctx, store) => {
  const deps = await papersDeps(store);
  if (!deps) throw missingKey('SERPAPI_KEY');
  return json(await syncPapers(store, deps));
});
