import { z } from 'astro/zod';
import { field, lenientOnly, list } from '../career/settings';

export const ARXIV_CATEGORY = /^[a-z-]+(\.[A-Za-z-]+)?$/;
/** bioRxiv and medRxiv collections: lowercase words, '_' for spaces. */
export const RXIV_CATEGORY = /^[a-z]+(_[a-z]+)*$/;
const arxivCategory = z.string().regex(ARXIV_CATEGORY, 'An arXiv category, like cs.CL');
const rxivCategory = z.string().regex(RXIV_CATEGORY, "Lowercase words, '_' for spaces");
const topic = z.object({ id: z.string().regex(/^(fields|subfields)\/\d+$/), name: z.string() });

/** A source: `on` plus its own fields; lenient falls back per field, strict surfaces inner errors. */
const source = <T extends z.ZodRawShape>(l: boolean, on: boolean, shape: T, rest: z.output<z.ZodObject<T>>) =>
  lenientOnly(l, z.object({ on: field(l, z.boolean(), on), ...shape }), () => ({ on, ...rest }) as never);

const prefsSchema = (l: boolean) => {
  const sources = {
    arxiv: source(l, false, { categories: list(l, arxivCategory) }, { categories: [] }),
    biorxiv: source(l, false, { categories: list(l, rxivCategory) }, { categories: [] }),
    medrxiv: source(l, false, { categories: list(l, rxivCategory) }, { categories: [] }),
    pubmed: source(l, false, { query: field(l, z.string(), '') }, { query: '' }),
    openalex: source(l, false, { topics: list(l, topic) }, { topics: [] }),
    huggingface: source(l, false, {}, {}),
    bluesky: source(l, true, {}, {}),
    alphaxiv: source(l, false, {}, {}),
  };
  const sourcesSchema = z.object(sources);
  return z.object({
    field: field(l, z.string().max(2000), ''),
    keywords: field(l, z.array(z.string().min(1).max(60)).max(30), []),
    area: field(l, z.string().max(200), ''),
    sources: lenientOnly(l, sourcesSchema, () => sourcesSchema.parse({})),
    talked: field(l, z.number().int().min(0).max(20), 5),
    inField: field(l, z.number().int().min(0).max(30), 8),
    minScore: field(l, z.number().min(0).max(100), 60),
    maxAiCalls: field(l, z.number().int().min(1).max(100), 20),
    roomAiCalls: field(l, z.number().int().min(1).max(1000), 100),
    paused: field(l, z.boolean(), false),
    email: lenientOnly(
      l,
      z.object({ on: field(l, z.boolean(), false), to: field(l, z.string(), ''), from: field(l, z.string(), '') }),
      () => ({ on: false, to: '', from: '' }),
    ),
  });
};

export type ReadingPrefs = z.output<ReturnType<typeof prefsSchema>>;

const lenient = prefsSchema(true);
const strict = prefsSchema(false);
const isObject = (raw: unknown) => !!raw && typeof raw === 'object' && !Array.isArray(raw);

/** Stored data never breaks the screen: unknown keys dropped, wrong types replaced by defaults. */
export const parseReadingPrefs = (raw: unknown): ReadingPrefs => lenient.parse(isObject(raw) ? raw : {});
/** For PUT: throws ZodError, which `route()` turns into field errors. */
export const validateReadingPrefs = (raw: unknown): ReadingPrefs => strict.parse(raw);
