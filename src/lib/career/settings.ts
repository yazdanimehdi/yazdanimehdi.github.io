import { z } from 'astro/zod';

/** One definition, two schemas: lenient (`.catch`: stored junk falls back to defaults) and strict (`.default`: a PUT with junk throws). */
const field = <T extends z.ZodType>(lenient: boolean, schema: T, fallback: z.output<T>) =>
  (lenient ? schema.catch(fallback) : schema.default(fallback as never)) as z.ZodType<z.output<T>>;

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
    watched: strings(l),
    feeds: strings(l),
    /** A style id; '' means the public style. */
    cvStyle: field(l, z.string(), ''),
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
    links: field(l, z.array(z.object({ label: z.string(), url: z.string() })), []),
    whyLooking: field(l, z.string(), ''),
    eeo: z
      .object({
        mode: field(l, z.enum(['decline', 'answer']), 'decline'),
        gender: field(l, z.string(), ''),
        race: field(l, z.string(), ''),
        veteran: field(l, z.string(), ''),
        disability: field(l, z.string(), ''),
      })
      .catch(() => ({ mode: 'decline' as const, gender: '', race: '', veteran: '', disability: '' })),
  });

export type CareerPrefs = z.output<ReturnType<typeof prefsSchema>>;
export type ApplicationAnswers = z.output<ReturnType<typeof answersSchema>>;

const lenientPrefs = prefsSchema(true);
const strictPrefs = prefsSchema(false);
const lenientAnswers = answersSchema(true);
const strictAnswers = answersSchema(false);

/** Stored data never breaks the screen: unknown keys dropped, wrong types replaced by defaults. */
export const parsePrefs = (raw: unknown): CareerPrefs => lenientPrefs.parse(raw && typeof raw === 'object' ? raw : {});
export const parseAnswers = (raw: unknown): ApplicationAnswers =>
  lenientAnswers.parse(raw && typeof raw === 'object' ? raw : {});

/** For PUT: throws ZodError, which `route()` turns into field errors. */
export const validatePrefs = (raw: unknown): CareerPrefs => strictPrefs.parse(raw);
export const validateAnswers = (raw: unknown): ApplicationAnswers => strictAnswers.parse(raw);
