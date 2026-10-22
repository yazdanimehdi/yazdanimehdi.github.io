import { generateText, readAiConfig } from '../../../../lib/admin/ai';
import { HttpError, json } from '../../../../lib/admin/http';
import { paperLookupFor } from '../../../../lib/admin/papers';
import { getSecret } from '../../../../lib/admin/secrets';
import { cvTextOf } from '../../../../lib/career/cv-text';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { readReading } from '../../../../lib/reading/db';
import { readProfile } from '../../../../lib/reading/profile';
import { parseReadingSuggestion, readingSuggestPrompt } from '../../../../lib/reading/prompts';
import { parseReadingPrefs } from '../../../../lib/reading/settings';
import { searchTopics } from '../../../../lib/reading/sources/traction';

export const prerender = false;

/**
 * `{ prefs }`: the current prefs with field, keywords, area and sources filled from the CV, research areas and
 * publications; a source is on when the suggestion gives it something. Nothing is saved. One AI call, no retry.
 */
export const POST = careerRoute(async (_ctx, store) => {
  const sql = getSql();
  const [text, profile] = await Promise.all([cvTextOf(store), readProfile(store)]);
  if (!text && !profile.areas.length) throw new HttpError(400, 'Add a CV or research areas first');
  const reply = await generateText(store, await readAiConfig(store), readingSuggestPrompt(text, profile));
  let s;
  try {
    s = parseReadingSuggestion(reply);
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
  const [{ prefs: stored }, lookup, key] = await Promise.all([
    readReading(sql),
    paperLookupFor(store),
    getSecret(sql, 'OPENALEX_API_KEY'),
  ]);
  // Each name: the field or subfield with exactly that name, else the first subfield found; else (or if OpenAlex
  // fails) it is dropped.
  const topics = new Map<string, { id: string; name: string }>();
  for (const name of s.openalex) {
    const found = await searchTopics(lookup.get, name, key).catch(() => []);
    const hit =
      found.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? found.find((t) => t.level === 'subfield');
    if (hit) topics.set(hit.id, { id: hit.id, name: hit.name });
  }
  const prefs = parseReadingPrefs(stored);
  const { sources } = prefs;
  return json({
    prefs: {
      ...prefs,
      field: s.field,
      keywords: s.keywords,
      area: s.area,
      sources: {
        ...sources,
        arxiv: { on: s.arxiv.length > 0, categories: s.arxiv },
        biorxiv: { on: s.biorxiv.length > 0, categories: s.biorxiv },
        medrxiv: { on: s.medrxiv.length > 0, categories: s.medrxiv },
        pubmed: { on: !!s.pubmed, query: s.pubmed },
        openalex: { on: topics.size > 0, topics: [...topics.values()] },
        huggingface: { on: s.huggingface },
      },
    },
  });
});
