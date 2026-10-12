import { json, route } from '../../../../lib/admin/http';
import { papersDeps, syncPapers } from '../../../../lib/admin/papers';
import { missingKey } from '../../../../lib/admin/secrets';

export const prerender = false;

/** "Check now" on the AI screen, both modes: new Scholar papers become publications and draft posts. */
export const POST = route(async (_ctx, store) => {
  const deps = await papersDeps(store);
  if (!deps) throw missingKey('SERPAPI_KEY');
  return json(await syncPapers(store, deps));
});
