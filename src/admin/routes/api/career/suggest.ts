import { generateText, readAiConfig } from '../../../../lib/admin/ai';
import { listEntries } from '../../../../lib/admin/content';
import { HttpError, json } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { cvTextOf, readCv } from '../../../../lib/career/cv-text';
import { contactAnswers, cvLocations, parseSuggestion, suggestPrompt } from '../../../../lib/career/suggest';

export const prerender = false;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** `{ prefs, answers }` suggested from the CV and publications (locations from the CV's contact line); nothing is saved. One AI call, no retry. */
export const POST = careerRoute(async (_ctx, store) => {
  const [text, cv] = await Promise.all([cvTextOf(store), readCv(store)]);
  if (!text) throw new HttpError(400, 'There is no CV yet: add one on the CV screen');
  const [pubs, ai] = await Promise.all([listEntries(store, 'publications'), readAiConfig(store)]);
  const papers = pubs.flatMap(({ data }) => {
    const title = str(data.title);
    return title ? [{ title, topic: str(data.topic), abstract: str(data.abstract) }] : [];
  });
  const reply = await generateText(store, ai, suggestPrompt(text, papers));
  let prefs;
  try {
    prefs = { ...parseSuggestion(reply), locations: cvLocations(cv) };
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
  return json({ prefs, answers: contactAnswers(cv) });
});
