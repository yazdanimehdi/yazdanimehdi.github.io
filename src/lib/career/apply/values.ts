// Values for a browser-read application form. The same rules as the Greenhouse form answers (answers.ts): the CV and
// Application answers first, EEO only by the owner's setting, the AI for the rest, and a hand-off whenever unsure.
import type { TextInput } from '../../ai/providers';
import type { CvConfig } from '../../types';
import {
  aiAnswer,
  answerFacts,
  cap,
  DECLINE,
  fencedPosting,
  isEeo,
  knownAnswer,
  type FormAnswer,
  type GhQuestion,
} from '../answers';
import { cvText } from '../profile';
import { jsonObject, UNTRUSTED } from '../prompts';
import type { ApplicationAnswers } from '../settings';
import { visible } from '../text';
import type { Posting } from '../types';
import type { ApplyField } from './types';

// A browser form has no Greenhouse field names, so its labels are mapped onto the ones answers.ts knows.
const BY_LABEL: [RegExp, string][] = [
  [/^(?:your |legal )?first name$|^given name$/, 'first_name'],
  [/^(?:your |legal )?last name$|^surname$|^family name$/, 'last_name'],
  [/^(?:your |full |legal )*name$/, 'name'],
  [/^(?:your )?e-?mail(?: address)?$/, 'email'],
  [/^(?:your )?(?:phone|mobile|telephone)(?: number)?$/, 'phone'],
  [/^(?:current )?location$/, 'location'],
];
// The one place a file field's upload is chosen: the runner uploads exactly the file its value names.
const COVER_LETTER = /cover letter/;
const CV_FILE = /resume|résumé|\bcv\b|curriculum/;

const TYPE: Record<ApplyField['kind'], string> = {
  text: 'input_text',
  email: 'input_text',
  tel: 'input_text',
  url: 'input_text',
  number: 'input_text',
  date: 'input_text',
  textarea: 'textarea',
  select: 'multi_value_single_select',
  radio: 'multi_value_single_select',
  checkbox: 'multi_value_multi_select',
  file: 'input_file',
};

const plain = (label: string) =>
  label
    .replace(/\(required\)|[*:]/gi, '')
    .trim()
    .toLowerCase();

function question(f: ApplyField): GhQuestion {
  const label = plain(f.label);
  const field = BY_LABEL.find(([re]) => re.test(label))?.[1] ?? '';
  const options = f.options ?? [];
  return {
    label: f.label,
    description: '',
    required: f.required,
    field,
    // A lone checkbox (no options) takes a free value, like a text field.
    type: f.kind === 'checkbox' && !options.length ? 'input_text' : TYPE[f.kind],
    options: options.map((o) => ({ label: o, decline: DECLINE.test(o) })),
    eeo: isEeo(f.label),
  };
}

const withAnswer = (f: ApplyField, a: Pick<FormAnswer, 'value' | 'source' | 'note'>): ApplyField => ({
  id: f.id,
  label: f.label,
  kind: f.kind,
  required: f.required,
  ...(f.options ? { options: f.options } : {}),
  value: a.value,
  source: a.source,
  ...(a.note ? { note: a.note } : {}),
});
const handoff = (f: ApplyField, note: string) => withAnswer(f, { value: '', source: 'handoff', note });

/** Left for the AI by `knownValues`: an empty value whose source is still to come. */
const pending = (f: ApplyField) => f.source === 'ai' && !f.value;

/** A file field's value names its upload: `cv`, `letter` (when there is one), or '' and a hand-off. */
function upload(f: ApplyField, hasLetter: boolean): ApplyField {
  const label = plain(f.label);
  const file = (value: string) => withAnswer(f, { value, source: 'file', note: 'uploaded with the application' });
  if (COVER_LETTER.test(label)) return hasLetter ? file('letter') : handoff(f, 'there is no cover letter to upload');
  if (CV_FILE.test(label)) return file('cv');
  return handoff(f, 'only your CV and cover letter are uploaded');
}

/**
 * Fills what the CV and Application answers know (EEO per `answers.eeo.mode`), names the upload of each file field
 * (`upload`), and leaves the rest value '' with source 'ai' for `valuesPrompt`. A fact the data should hold but
 * doesn't is a hand-off, never sent to the AI.
 */
export function knownValues(
  fields: ApplyField[],
  cv: CvConfig,
  answers: ApplicationAnswers,
  hasLetter = true,
): ApplyField[] {
  return fields.map((f) => {
    if (f.kind === 'file') return upload(f, hasLetter);
    return withAnswer(f, knownAnswer(question(f), cv, answers) ?? { value: '', source: 'ai' });
  });
}

/** Asks the AI for the fields `knownValues` left empty; their labels and options are fenced with the posting. */
export function valuesPrompt(
  fields: ApplyField[],
  p: Pick<Posting, 'company' | 'title' | 'location' | 'description'>,
  cv: CvConfig,
  answers: ApplicationAnswers,
  letter: string,
): TextInput {
  const asked = fields.filter(pending).map((f) => ({
    id: cap(f.id),
    label: cap(f.label),
    kind: f.kind,
    required: f.required,
    ...(f.options?.length ? { options: f.options.slice(0, 50).map((o) => cap(o)) } : {}),
  }));
  return {
    system: [
      'You fill in a job application form for a candidate.',
      'Answer only from the candidate’s CV, application answers and cover letter. Never invent a fact, number, employer, skill, date or opinion.',
      'Set "confident": false with "value": "" when the answer is not in them or the field needs the candidate’s own choice.',
      'When a field has options, "value" must be exactly one of them (for a checkbox list, options joined by "; "). Keep text answers concise and in first person.',
      UNTRUSTED,
      'Reply with JSON only: {"values":[{"id":string,"value":string,"confident":boolean}]}, one entry per field.',
    ].join('\n'),
    prompt: [
      `Candidate CV:\n${cvText(cv)}`,
      `Application answers:\n${answerFacts(answers)}`,
      `Cover letter for this job:\n${cap(letter, 6000) || '(none)'}`,
      fencedPosting(p, asked),
    ].join('\n\n'),
    maxTokens: 4000,
  };
}

/**
 * Merges a model reply into `fields`. Only the fields `knownValues` left for the AI change: an unsure, skipped or
 * out-of-options value is a hand-off, and a reply with no JSON object hands off every one of them.
 */
export function parseValues(reply: string, fields: ApplyField[]): ApplyField[] {
  let raw: Record<string, unknown>;
  try {
    raw = jsonObject(reply, 'no JSON');
  } catch {
    return fields.map((f) => (pending(f) ? handoff(f, 'the model’s reply could not be read') : f));
  }
  const given = new Map<string, { value: string; handoff: boolean; note: string }>();
  for (const r of Array.isArray(raw.values) ? raw.values : []) {
    const id = typeof r?.id === 'string' ? r.id : '';
    if (!fields.some((f) => f.id === id && pending(f)) || given.has(id)) continue;
    const value = typeof r.value === 'string' ? visible(r.value).trim().slice(0, 5000) : '';
    const sure = r.confident === true;
    given.set(id, {
      value,
      handoff: !sure,
      note: sure ? '' : `the AI was not sure${value ? ` (it suggested "${value.slice(0, 100)}")` : ''}`,
    });
  }
  return fields.map((f) => (pending(f) ? withAnswer(f, aiAnswer(question(f), given.get(f.id))) : f));
}

/** "Needs your answer: <label>" for the first required field without a value (uploads aside); null when none. */
export function needsHandoff(fields: ApplyField[]): string | null {
  const f = fields.find((x) => x.required && (x.source === 'handoff' || (x.source !== 'file' && !x.value)));
  return f ? `Needs your answer: ${f.label}` : null;
}
