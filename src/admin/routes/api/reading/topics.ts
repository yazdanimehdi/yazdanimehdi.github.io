import { HttpError, json } from '../../../../lib/admin/http';
import { paperLookupFor } from '../../../../lib/admin/papers';
import { getSecret } from '../../../../lib/admin/secrets';
import { SourceError } from '../../../../lib/career/sources/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { searchTopics } from '../../../../lib/reading/sources/traction';

export const prerender = false;

/** `?q=`: OpenAlex fields, then subfields, matching it (at most 10). */
export const GET = careerRoute(async (ctx, store) => {
  const q = (ctx.url.searchParams.get('q') ?? '').trim();
  if (q.length < 2 || q.length > 100) throw new HttpError(400, '`q` must be 2 to 100 characters');
  const [lookup, key] = await Promise.all([paperLookupFor(store), getSecret(getSql(), 'OPENALEX_API_KEY')]);
  try {
    return json(await searchTopics(lookup.get, q, key));
  } catch (e) {
    throw new HttpError(502, e instanceof SourceError ? e.message : 'OpenAlex did not answer');
  }
});
