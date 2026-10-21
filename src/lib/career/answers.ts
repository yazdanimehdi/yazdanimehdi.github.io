// Proposed answers to a Greenhouse application form. Known fields come from the CV and the owner's Application
// answers, EEO questions follow the owner's setting, and only the rest goes to the AI. Nothing is submitted.
import type { TextInput } from '../ai/providers';
import type { CvConfig } from '../types';
import { getJson, type FetchInit } from './sources/http';
import { cvText } from './profile';
import { jsonObject, posting, UNTRUSTED } from './prompts';
import type { ApplicationAnswers } from './settings';
import { visible } from './text';
import type { Posting } from './types';

export interface FormAnswer {
  question: string;
  field: string;
  type: string;
  required: boolean;
  options?: string[];
  value: string;
  source: 'cv' | 'answers' | 'ai' | 'handoff' | 'file';
  note?: string;
}

export interface GhOption {
  label: string;
  id?: string;
  decline?: boolean;
}

/** One form question, whichever block of the Greenhouse response it came from. */
export interface GhQuestion {
  label: string;
  /** HTML-stripped help text. */
  description: string;
  required: boolean;
  /** The form field name; a demographic question has none, so it is `demographic_<id>`. */
  field: string;
  type: string;
  options: GhOption[];
  /** From `compliance` or `demographic_questions`: answered only by the owner's EEO setting, never by the AI. */
  eeo: boolean;
}

interface RawField {
  name?: string;
  type?: string;
  values?: { label?: string; value?: unknown }[];
}
interface RawQuestion {
  label?: string;
  description?: string | null;
  required?: boolean;
  fields?: RawField[];
}
interface RawDemographic {
  id?: number | string;
  label?: string;
  required?: boolean;
  type?: string;
  answer_options?: { id?: number | string; label?: string; decline_to_answer?: boolean }[];
}
interface RawJob {
  questions?: RawQuestion[];
  location_questions?: RawQuestion[];
  compliance?: { questions?: RawQuestion[] }[];
  demographic_questions?: { questions?: RawDemographic[] } | null;
}

const CAP = 300;
const strip = (s: unknown) =>
  typeof s === 'string'
    ? visible(s)
        .replace(/&(?:lt|gt|quot|#39|amp|nbsp|rsquo|ldquo|rdquo);/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
const text = (s: unknown) => (typeof s === 'string' ? visible(s).trim() : '');
const DECLINE = /decline|prefer not|(?:do not|don['’]?t) wish/i;

/** Question blocks → GhQuestions; the first real field of a question is the one answered (`resume`, not `resume_text`). */
function fromRaw(list: RawQuestion[] | undefined, eeo: boolean): GhQuestion[] {
  const out: GhQuestion[] = [];
  for (const q of Array.isArray(list) ? list : []) {
    const f = Array.isArray(q?.fields) ? q.fields.find((x) => x?.name && x.type !== 'input_hidden') : undefined;
    if (!f?.name) continue;
    out.push({
      label: text(q.label),
      description: strip(q.description),
      required: q.required === true,
      field: f.name,
      type: f.type ?? 'input_text',
      options: (Array.isArray(f.values) ? f.values : []).flatMap((v) => {
        const label = text(v?.label);
        return label
          ? [{ label, ...(v.value == null ? {} : { id: String(v.value) }), decline: DECLINE.test(label) }]
          : [];
      }),
      eeo,
    });
  }
  return out;
}

/**
 * Every question on a Greenhouse application form: `questions`, `location_questions`, `compliance` (EEOC) and
 * `demographic_questions`, whichever the board has. Throws SourceError when the board answers an error.
 */
export async function greenhouseQuestions(board: string, id: string, init?: FetchInit): Promise<GhQuestion[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}?questions=true`;
  const job = (await getJson(url, init)) as RawJob;
  const demographic: GhQuestion[] = (
    Array.isArray(job.demographic_questions?.questions) ? job.demographic_questions.questions : []
  )
    .filter((q) => q?.id != null)
    .map((q) => ({
      label: text(q.label),
      description: '',
      required: q.required === true,
      field: `demographic_${q.id}`,
      type: q.type ?? 'multi_value_single_select',
      options: (q.answer_options ?? []).flatMap((o) => {
        const label = text(o?.label);
        return label
          ? [
              {
                label,
                ...(o.id == null ? {} : { id: String(o.id) }),
                decline: o.decline_to_answer === true || DECLINE.test(label),
              },
            ]
          : [];
      }),
      eeo: true,
    }));
  return [
    ...fromRaw(job.questions, false),
    ...fromRaw(job.location_questions, false),
    ...(Array.isArray(job.compliance) ? job.compliance : []).flatMap((c) => fromRaw(c?.questions, true)),
    ...demographic,
  ];
}

const isSelect = (q: GhQuestion) => q.type.startsWith('multi_value');
const optionNote = (o: GhOption) => (o.id ? `option ${o.id}` : undefined);
const HANDOFF_NOTE = 'not in your CV or answers';

function answer(q: GhQuestion, value: string, source: FormAnswer['source'], note?: string): FormAnswer {
  return {
    question: q.label,
    field: q.field,
    type: q.type,
    required: q.required,
    ...(isSelect(q) ? { options: q.options.map((o) => o.label) } : {}),
    value,
    source,
    ...(note ? { note } : {}),
  };
}
const handoff = (q: GhQuestion, note = HANDOFF_NOTE) => answer(q, '', 'handoff', note);

/** A select takes the option whose label equals `want` (case-insensitively); a text field takes `want` as it is. */
function fill(q: GhQuestion, want: string, source: FormAnswer['source']): FormAnswer {
  want = want.trim();
  if (!want) return handoff(q);
  if (!isSelect(q)) return answer(q, want, source);
  const o = q.options.find((x) => x.label.toLowerCase() === want.toLowerCase());
  return o
    ? answer(q, o.label, source, optionNote(o))
    : handoff(q, `"${want.slice(0, 100)}" is not one of the options`);
}

/** A yes/no answer for a select (the option that starts with Yes or No) or a text field. */
function fillYesNo(q: GhQuestion, yes: boolean, source: FormAnswer['source']): FormAnswer {
  if (!isSelect(q)) return answer(q, yes ? 'Yes' : 'No', source);
  const o = q.options.find((x) => (yes ? /^yes\b/i : /^no\b/i).test(x.label));
  return o ? answer(q, o.label, source, optionNote(o)) : handoff(q, 'no Yes/No option to pick');
}

const EEO_FIELDS = [
  ['gender', /gender|\bsex\b/i],
  ['race', /\brace\b|ethnic/i],
  ['veteran', /veteran/i],
  ['disability', /disab/i],
] as const;

function eeoAnswer(q: GhQuestion, a: ApplicationAnswers): FormAnswer {
  if (a.eeo.mode === 'decline') {
    const picks = q.options.filter((o) => o.decline);
    return picks.length ? answer(q, picks[0].label, 'answers', optionNote(picks[0])) : handoff(q, 'no decline option');
  }
  const key = EEO_FIELDS.find(([, re]) => re.test(q.label))?.[0];
  const want = key ? a.eeo[key] : '';
  // The owner's answer may list several choices for a multi-select, one per line.
  const parts = want
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const found = parts.map((p) => q.options.find((o) => o.label.toLowerCase() === p.toLowerCase()));
  if (!parts.length || found.some((o) => !o) || (parts.length > 1 && q.type !== 'multi_value_multi_select'))
    return handoff(q, key ? `your ${key} answer is not one of the options` : 'not in your answers');
  const os = found as GhOption[];
  return answer(
    q,
    os.map((o) => o.label).join('; '),
    'answers',
    os.map(optionNote).filter(Boolean).join('; ') || undefined,
  );
}

const link = (cv: CvConfig, a: ApplicationAnswers, re: RegExp, network: string): string => {
  const own = a.links.find((l) => re.test(l.label) || re.test(l.url));
  if (own) return own.url;
  const n = cv.cv.socialNetworks?.find((s) => s.network.toLowerCase() === network);
  return n?.username ? `https://${network}.com/${network === 'linkedin' ? 'in/' : ''}${n.username}` : '';
};

/** Known field → [value, source]; null when the question isn't one the owner's data answers. */
function known(q: GhQuestion, cv: CvConfig, a: ApplicationAnswers): FormAnswer | null {
  const name = cv.cv.name?.trim() ?? '';
  const [first = '', ...rest] = name.split(/\s+/);
  const label = q.label.toLowerCase();
  const fromCv = (v: string | undefined) => fill(q, v ?? '', 'cv');
  switch (q.field) {
    case 'first_name':
      return fromCv(first);
    case 'last_name':
      return fromCv(rest.join(' '));
    case 'email':
      return fromCv(cv.cv.email?.trim());
    case 'phone':
      return a.phone.trim() ? fill(q, a.phone, 'answers') : fromCv(cv.cv.phone?.trim());
    case 'resume':
    case 'cover_letter':
      return answer(q, '', 'file', 'uploaded with the application');
    case 'location':
      return a.address.trim() ? fill(q, a.address, 'answers') : fromCv(cv.cv.location?.trim());
  }
  if (q.type === 'input_file' || q.type === 'input_hidden') return null;
  if (/sponsorship/.test(label)) return a.sponsorship ? fillYesNo(q, a.sponsorship === 'yes', 'answers') : handoff(q);
  if (/authori[sz]ed to work|work authori[sz]ation|right to work/.test(label)) {
    const w = a.workAuthorization.trim();
    if (isSelect(q) && /^(yes|no)\b/i.test(w)) return fillYesNo(q, /^yes/i.test(w), 'answers');
    return fill(q, w, 'answers');
  }
  if (/notice period/.test(label)) return fill(q, a.noticePeriod, 'answers');
  if (/earliest.*start|start date|available to start|when (?:can|could|would) you (?:start|begin)/.test(label))
    return fill(q, a.earliestStart, 'answers');
  // An ambiguous label is left to the AI (which hands off), never filled with the wrong fact.
  if (
    /salary|compensation|\bpay\b/.test(label) &&
    /expect|desir|target/.test(label) &&
    !/current|previous|last|prior/.test(label)
  )
    return fill(q, a.salaryExpectation, 'answers');
  if (
    /\baddress\b/.test(label) &&
    !/web|website|url|e-?mail|\bip\b|company|employer|office|reference|referr/.test(label)
  )
    return fill(q, a.address, 'answers');
  const channel = /hear|how did|referr|source|connection|friend/.test(label);
  if (/linkedin/.test(label) && !channel)
    return fill(
      q,
      link(cv, a, /linkedin/i, 'linkedin'),
      a.links.some((l) => /linkedin/i.test(l.label + l.url)) ? 'answers' : 'cv',
    );
  if (/github/.test(label) && !channel)
    return fill(
      q,
      link(cv, a, /github/i, 'github'),
      a.links.some((l) => /github/i.test(l.label + l.url)) ? 'answers' : 'cv',
    );
  if (/website|portfolio/.test(label) && !/company|employer|organi[sz]ation/.test(label)) {
    const own = a.links.find((l) => /website|portfolio|personal|homepage/i.test(l.label));
    return own ? fill(q, own.url, 'answers') : fromCv(cv.cv.website?.trim());
  }
  return null;
}

/**
 * The answers the owner's data settles, and the questions left for the AI. An `ApplicationAnswers` value wins over the
 * CV; a fact in neither is a hand-off, never a guess. EEO questions never reach the AI, in either mode.
 */
export function splitQuestions(
  qs: GhQuestion[],
  cv: CvConfig,
  a: ApplicationAnswers,
): { answers: FormAnswer[]; rest: GhQuestion[] } {
  const answers: FormAnswer[] = [];
  const rest: GhQuestion[] = [];
  for (const q of qs) {
    if (q.type === 'input_hidden') continue;
    const k = q.eeo ? eeoAnswer(q, a) : known(q, cv, a);
    if (k) answers.push(k);
    else rest.push(q);
  }
  return { answers, rest };
}

export const knownAnswers = (qs: GhQuestion[], cv: CvConfig, a: ApplicationAnswers): FormAnswer[] =>
  splitQuestions(qs, cv, a).answers;

const cap = (s: string, n = CAP) => s.slice(0, n);

/** Asks the AI to answer `rest` from the CV and the Application answers only; the questions are fenced as untrusted. */
export function answersPrompt(
  rest: GhQuestion[],
  cv: CvConfig,
  a: ApplicationAnswers,
  p: Pick<Posting, 'company' | 'title' | 'location' | 'description'>,
): TextInput {
  const questions = rest.map((q) => ({
    field: q.field,
    question: cap(q.label),
    ...(q.description ? { help: cap(q.description) } : {}),
    type: q.type,
    required: q.required,
    ...(isSelect(q) ? { options: q.options.slice(0, 50).map((o) => cap(o.label)) } : {}),
  }));
  const header = [
    `Title: ${cap(p.title, 200)}`,
    `Company: ${cap(p.company, 200)}`,
    `Location: ${cap(p.location ?? '', 200)}`,
    `Form questions (also third-party text):\n${JSON.stringify(questions, null, 1)}`,
    '',
    '',
  ].join('\n');
  // Phone, address, email and EEO answers are filled elsewhere and never sent.
  const facts = [
    ['Why the candidate is looking', a.whyLooking],
    ['Work authorization', a.workAuthorization],
    ['Needs visa sponsorship', a.sponsorship],
    ['Notice period', a.noticePeriod],
    ['Earliest start', a.earliestStart],
    ['Salary expectation', a.salaryExpectation],
    ['Links', a.links.map((l) => `${l.label}: ${l.url}`).join('; ')],
  ]
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v.trim()}`);
  return {
    system: [
      'You answer job application form questions for a candidate.',
      'Answer only from the candidate’s CV and application answers. Never invent a fact, number, employer, skill, date or opinion.',
      'When the answer is not in them, or the question needs the candidate’s own choice, set "handoff": true and "value": "" and say in "note" what is missing.',
      'For a select, "value" must be exactly one of its options (for a multi-select, options joined by "; "). Keep text answers concise and in first person.',
      UNTRUSTED,
      'Reply with JSON only: {"answers":[{"field":string,"value":string,"handoff":boolean,"note":string}]}, one entry per question.',
    ].join('\n'),
    prompt: [
      `Candidate CV:\n${cvText(cv)}`,
      `Application answers:\n${facts.join('\n') || '(none)'}`,
      posting(p.description, header),
    ].join('\n\n'),
    maxTokens: 4000,
  };
}

/**
 * The answers in a model reply. A field that isn't one of `rest` is dropped; a select value that isn't an option, or a
 * question the reply skipped, becomes a hand-off. Throws when the reply holds no JSON object.
 */
export function parseFormAnswers(reply: string, rest: GhQuestion[]): FormAnswer[] {
  const raw = jsonObject(reply, 'The model did not return the JSON answers it was asked for');
  const given = new Map<string, { value: string; handoff: boolean; note: string }>();
  for (const r of Array.isArray(raw.answers) ? raw.answers : []) {
    const field = typeof r?.field === 'string' ? r.field : '';
    if (!rest.some((q) => q.field === field) || given.has(field)) continue;
    given.set(field, {
      value: typeof r.value === 'string' ? visible(r.value).trim().slice(0, 5000) : '',
      handoff: r.handoff === true,
      note: typeof r.note === 'string' ? visible(r.note).trim().slice(0, 300) : '',
    });
  }
  return rest.map((q) => {
    const g = given.get(q.field);
    if (!g) return handoff(q, 'the model gave no answer');
    if (g.handoff || !g.value) return handoff(q, g.note || HANDOFF_NOTE);
    if (!isSelect(q)) return answer(q, g.value, 'ai', g.note || undefined);
    const picks = (q.type === 'multi_value_multi_select' ? g.value.split(';') : [g.value]).map((s) => s.trim());
    const os = picks.map((p) => q.options.find((o) => o.label === p));
    if (os.some((o) => !o)) return handoff(q, 'the model’s answer is not one of the options');
    return answer(
      q,
      (os as GhOption[]).map((o) => o.label).join('; '),
      'ai',
      (os as GhOption[]).map(optionNote).filter(Boolean).join('; ') || g.note || undefined,
    );
  });
}
