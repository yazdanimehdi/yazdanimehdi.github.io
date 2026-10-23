import { z } from 'astro/zod';

/** One definition, two schemas: lenient (`.catch`: stored junk falls back to defaults) and strict (`.default`: a PUT with junk throws). */
export const field = <T extends z.ZodType>(lenient: boolean, schema: T, fallback: z.output<T>) =>
  (lenient ? schema.catch(fallback) : schema.default(fallback as never)) as z.ZodType<z.output<T>>;

export const httpUrl = z.string().refine((v) => {
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}, 'Must be an http(s) URL');

/** Lenient: invalid entries are dropped, the rest kept. Strict: any invalid entry is a field error. */
export const list = <T extends z.ZodType>(lenient: boolean, item: T) =>
  (lenient
    ? z
        .array(z.unknown())
        .transform((a) => a.filter((x) => item.safeParse(x).success).map((x) => item.parse(x)))
        .catch([])
    : z.array(item).default([])) as z.ZodType<z.output<T>[]>;

/** Lenient `.catch`es the whole object; strict only defaults a missing one, so inner field errors surface. */
export const lenientOnly = <T extends z.ZodType>(lenient: boolean, schema: T, fallback: () => z.output<T>) =>
  (lenient ? schema.catch(fallback as never) : schema.default(fallback() as never)) as z.ZodType<z.output<T>>;

const strings = (l: boolean) => field(l, z.array(z.string()), []);

const prefsSchema = (l: boolean) =>
  z.object({
    roles: strings(l),
    keywords: strings(l),
    seniority: strings(l),
    locations: strings(l),
    remote: field(l, z.enum(['any', 'remote', 'hybrid', 'onsite']), 'any'),
    languages: field(l, z.array(z.object({ language: z.string(), level: z.string() })), []),
    salaryFloor: field(
      l,
      z
        .object({ amount: z.number().min(0), currency: z.string(), period: z.enum(['year', 'month', 'hour']) })
        .nullable(),
      null,
    ),
    fields: strings(l),
    mustHaves: strings(l),
    dealBreakers: strings(l),
    avoidCompanies: strings(l),
    threshold: field(l, z.number().min(0).max(100), 70),
    maxScoresPerRun: field(l, z.number().int().min(1).max(500), 100),
    sources: field(
      l,
      z.record(z.string(), z.object({ on: z.boolean(), options: z.record(z.string(), z.string()).optional() })),
      {},
    ),
    watched: list(l, httpUrl),
    feeds: list(l, httpUrl),
    /** A style id; '' means the public style. */
    cvStyle: field(l, z.string(), ''),
    nightly: lenientOnly(
      l,
      z.object({
        /** How far the nightly run goes: 1 search, 2 + score, 3 + tailor, 4 + pre-fill. Never submits. */
        stage: field(l, z.literal([1, 2, 3, 4]), 3),
        maxDrafts: field(l, z.number().int().min(0).max(50), 5),
        perCompany: lenientOnly(
          l,
          z.object({
            max: field(l, z.number().int().min(1).max(50), 2),
            days: field(l, z.number().int().min(1).max(365), 30),
          }),
          () => ({ max: 2, days: 30 }),
        ),
        paused: field(l, z.boolean(), false),
      }),
      () => ({ stage: 3 as const, maxDrafts: 5, perCompany: { max: 2, days: 30 }, paused: false }),
    ),
    digest: lenientOnly(
      l,
      z.object({ on: field(l, z.boolean(), false), to: field(l, z.string(), ''), from: field(l, z.string(), '') }),
      () => ({ on: false, to: '', from: '' }),
    ),
    worker: field(
      l,
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('api') }),
        z.object({
          kind: z.literal('cli'),
          agent: z.enum(['claude', 'codex', 'gemini']),
          auth: z.enum(['key', 'subscription']),
        }),
      ]),
      { kind: 'api' },
    ),
  });

const answersSchema = (l: boolean) =>
  z.object({
    workAuthorization: field(l, z.string(), ''),
    sponsorship: field(l, z.enum(['', 'yes', 'no']), ''),
    noticePeriod: field(l, z.string(), ''),
    earliestStart: field(l, z.string(), ''),
    salaryExpectation: field(l, z.string(), ''),
    phone: field(l, z.string(), ''),
    address: field(l, z.string(), ''),
    links: list(l, z.object({ label: z.string(), url: httpUrl })),
    whyLooking: field(l, z.string(), ''),
    eeo: lenientOnly(
      l,
      z.object({
        mode: field(l, z.enum(['decline', 'answer']), 'decline'),
        gender: field(l, z.string(), ''),
        race: field(l, z.string(), ''),
        veteran: field(l, z.string(), ''),
        disability: field(l, z.string(), ''),
      }),
      () => ({ mode: 'decline' as const, gender: '', race: '', veteran: '', disability: '' }),
    ),
  });

export type CareerPrefs = z.output<ReturnType<typeof prefsSchema>>;
export type ApplicationAnswers = z.output<ReturnType<typeof answersSchema>>;

const lenientPrefs = prefsSchema(true);
const strictPrefs = prefsSchema(false);
const lenientAnswers = answersSchema(true);
const strictAnswers = answersSchema(false);

const isObject = (raw: unknown) => !!raw && typeof raw === 'object' && !Array.isArray(raw);

/** Stored data never breaks the screen: unknown keys dropped, wrong types replaced by defaults. */
export const parsePrefs = (raw: unknown): CareerPrefs => lenientPrefs.parse(isObject(raw) ? raw : {});
export const parseAnswers = (raw: unknown): ApplicationAnswers => lenientAnswers.parse(isObject(raw) ? raw : {});

/** For PUT: throws ZodError, which `route()` turns into field errors. */
export const validatePrefs = (raw: unknown): CareerPrefs => strictPrefs.parse(raw);
export const validateAnswers = (raw: unknown): ApplicationAnswers => strictAnswers.parse(raw);
