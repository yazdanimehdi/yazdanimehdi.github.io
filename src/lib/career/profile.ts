import type { CvConfig } from '../types';
import type { ApplicationAnswers, CareerPrefs } from './settings';

type Entry = Record<string, unknown>;

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const joined = (keys: string[], e: Entry, sep: string) =>
  keys
    .map((k) => text(e[k]))
    .filter(Boolean)
    .join(sep);

/** One line for an entry plus its highlights; an entry of an unknown shape becomes its JSON. */
function entryText(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return JSON.stringify(entry);
  const e = entry as Entry;
  if (e.visible === false) return '';
  const simple = ['bullet', 'number', 'reversedNumber'].find((k) => text(e[k]));
  let head = simple ? text(e[simple]) : '';
  if (!head) {
    head =
      [e.position, e.company, e.institution, e.area, e.degree, e.title, e.name].map(text).filter(Boolean).join(', ') ||
      joined(['label', 'details'], e, ': ');
  }
  if (!head) return JSON.stringify(entry);
  const authors = Array.isArray(e.authors) ? e.authors.map(text).filter(Boolean).join(', ') : '';
  const when = [text(e.startDate), text(e.endDate)].filter(Boolean).join(' to ') || text(e.date);
  const line = [head, authors, joined(['journal', 'location'], e, ', '), when].filter(Boolean).join(' | ');
  const highlights = Array.isArray(e.highlights) ? e.highlights.map(text).filter(Boolean) : [];
  const summary = text(e.summary);
  return [line, ...(summary ? [`  ${summary}`] : []), ...highlights.map((h) => `  - ${h}`)].join('\n');
}

/** The CV as plain compact text: identity first (no email or phone), then every non-empty section. */
export function cvText(cv: CvConfig): string {
  const { name, location, sections } = cv.cv;
  const c = cv.cv as unknown as Entry;
  const out = [name, text(c.headline) || text(c.label), text(location)].filter(Boolean);
  for (const [title, entries] of Object.entries(sections ?? {})) {
    const lines = (Array.isArray(entries) ? entries : []).map(entryText).filter(Boolean);
    if (lines.length) out.push('', `${title}:`, ...lines);
  }
  return out.join('\n');
}

/** The owner's non-empty preferences, plus work authorization for the eligibility gate. Never EEO, phone or address. */
export function prefsText(p: CareerPrefs, a?: ApplicationAnswers): string {
  const list = (label: string, v: string[]) => (v.length ? `${label}: ${v.join('; ')}` : '');
  const pay = p.salaryFloor;
  return [
    list('Roles wanted', p.roles),
    list('Keywords', p.keywords),
    list('Seniority', p.seniority),
    list('Locations', p.locations),
    p.remote !== 'any' ? `Work mode: ${p.remote}` : '',
    p.languages.length ? `Languages spoken: ${p.languages.map((l) => `${l.language} (${l.level})`).join(', ')}` : '',
    pay ? `Salary floor: ${pay.amount} ${pay.currency} per ${pay.period}` : '',
    list('Fields', p.fields),
    list('Must have', p.mustHaves),
    list('Deal breakers', p.dealBreakers),
    a?.workAuthorization ? `Work authorization: ${a.workAuthorization}` : '',
    a?.sponsorship ? `Needs visa sponsorship: ${a.sponsorship}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
