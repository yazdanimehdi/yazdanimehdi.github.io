import type { Requirement } from '../lib/career/tailor';
import type { Application, ApplyField, ApplyState } from '../lib/career/apply/types';
import type { SecretName } from '../lib/admin/secrets';
import type { FieldDef } from './fields';
import type { PostingSummary, RunSummary } from '../lib/career/types';

export interface RunStatus {
  runId: string | null;
  status: string | null;
  lastRun: RunSummary | null;
}

/** The last run in one line: its counts and the night's non-zero outcomes, or that the pause switch stopped it. */
export function runLine(r: RunSummary): string {
  if (r.paused) return 'Paused: nothing ran';
  const found = r.sources.reduce((n, s) => n + s.found, 0);
  const counts: [number | undefined, string][] = [
    [r.deferred, 'left for later'],
    [r.failed, 'failed to score'],
    [r.drafted, 'drafted'],
    [r.prefilled, 'pre-filled'],
    [r.handedOff, 'to finish yourself'],
    [r.limited, 'held back by limits'],
  ];
  return [`${found} found`, `${r.scored} scored`, ...counts.filter(([n]) => n).map(([n, what]) => `${n} ${what}`)].join(
    ' · ',
  );
}

/** The digest's outcome when it is Resend's error rather than sent or skipped. */
export const digestError = (r: RunSummary) =>
  r.digest && r.digest !== 'sent' && r.digest !== 'skipped' ? r.digest : null;

/** Still working: poll until it isn't. */
export const isRunning = (status: string | null) => status === 'running' || status === 'pending';

export { visible } from '../lib/career/text';

export type CoverageState = 'shown' | 'cut' | 'reworded' | 'gap';

export function coverageState(r: Requirement): CoverageState {
  return r.inCv ? 'shown' : r.inBase ? 'cut' : r.evidence ? 'reworded' : 'gap';
}

/** The drafter's evidence ref ("researchExperience 1", 0-based) as a 1-based entry for display; anything else as is. */
export function evidenceLabel(e: string): string {
  const m = /^(\S+) (\d+)$/.exec(e);
  return m ? `${m[1]} entry ${Number(m[2]) + 1}` : e;
}

export function coverageLine(reqs: Requirement[]): string {
  if (!reqs.length) return 'No requirements were listed for this posting.';
  const part = (kind: Requirement['kind']) => {
    const list = reqs.filter((r) => r.kind === kind);
    return { n: list.length, shown: list.filter((r) => coverageState(r) === 'shown').length };
  };
  const req = part('required');
  const pref = part('preferred');
  const gaps = reqs.filter((r) => coverageState(r) === 'gap').length;
  return (
    `Required: ${req.shown} of ${req.n} shown` +
    (pref.n ? ` · preferred: ${pref.shown} of ${pref.n}` : '') +
    (gaps ? ` · ${gaps} not in your CV` : '')
  );
}

/** The URL when it is http(s), else null: only those become links. */
export function httpUrl(u: string | null | undefined): string | null {
  try {
    return u && /^https?:$/.test(new URL(u).protocol) ? u : null;
  } catch {
    return null;
  }
}

/** GET career/ready: a posting waiting for approval and its pre-fill, if it has one. */
export type ReadyRow = PostingSummary & { prefilledAt: string | null; fields: number; state: ApplyState | null };

/** What a ready posting's application is doing, when it isn't simply waiting for approval. */
export const READY_STATE: Partial<Record<ApplyState | 'none', string>> = {
  none: 'Not pre-filled',
  prefilling: 'Pre-filling',
  approved: 'Approved, sending soon',
  submitting: 'Sending',
  unconfirmed: 'Sent, not confirmed',
  changed: 'The form changed',
  failed: 'Pre-fill failed',
  handoff: 'Finish it yourself',
};

/** The server is still working on the application: the job page polls until it isn't. */
export const isApplying = (s: ApplyState | null | undefined) =>
  s === 'prefilling' || s === 'approved' || s === 'submitting';

/** A lone checkbox's value, as the browser runner reads it. */
export const isTicked = (v: string | undefined) => /^(true|yes|on|1|checked)$/i.test(v ?? '');

/** A field with options to pick from: a select. */
export const isChoice = (f: ApplyField) => !!f.options?.length && (f.kind === 'select' || f.kind === 'radio');

const FIELD_SOURCES: Record<ApplyField['source'], string> = {
  cv: 'CV',
  answers: 'Answers',
  ai: 'AI',
  owner: 'You',
  handoff: 'Not filled',
  file: 'File',
};
/** Where a field's value came from; one the owner has edited is theirs. */
export const fieldSource = (f: ApplyField, value: string | undefined) =>
  value !== f.value ? 'You' : FIELD_SOURCES[f.source];

/** Which file the pre-fill uploads into a file field: its value names it ('cv', 'letter'), '' uploads nothing. */
export const uploadFor = (f: ApplyField) =>
  f.value === 'cv' ? 'Your tailored CV (PDF)' : f.value === 'letter' ? 'Your cover letter (PDF)' : 'Nothing uploaded';

/** An application's links, http(s) only: the form, its host, the screenshots and the files it uploads. */
export function applyLinks(app: Application, cvPdfUrl: string | null) {
  const form = httpUrl(app.url);
  return {
    form,
    host: form ? new URL(form).host : 'the employer’s site',
    shots: app.shots.map(httpUrl).filter((u): u is string => !!u),
    confirmation: httpUrl(app.confirmation),
    cv: httpUrl(app.cvPdf ?? cvPdfUrl),
    letter: httpUrl(app.letterPdf),
  };
}

/** Job search settings: how far the nightly run goes. */
export const STAGES = [
  [1, 'Search only', 'Finds new postings and nothing else.'],
  [2, '+ Score', 'Also scores each new posting against what you want.'],
  [
    3,
    '+ Tailor CV and letter (default)',
    'Also drafts a CV and cover letter for each match at or above the threshold.',
  ],
  [
    4,
    '+ Pre-fill applications for approval',
    'Also fills in each drafted posting’s form and lists it under Ready for approval.',
  ],
] as const;

export const LIMIT_FIELDS: FieldDef[] = [
  {
    key: 'nightly.maxDrafts',
    label: 'Drafts per night (0–50)',
    type: 'number',
    hint: 'Each draft is a few AI calls. The best matches go first; the rest wait for the next night.',
  },
  { key: 'nightly.perCompany.max', label: 'Applications per company', type: 'number' },
  {
    key: 'nightly.perCompany.days',
    label: 'Within this many days',
    type: 'number',
    hint: 'Postings at one company that you drafted, sent or moved further in this window count.',
  },
  { key: 'nightly.paused', label: 'Pause all nightly job search', type: 'checkbox' },
];

export type WorkerChoice = 'api' | 'claude' | 'codex' | 'gemini';
export const WORKERS: [WorkerChoice, string, string][] = [
  ['api', 'API keys (default)', 'Uses the writing provider on Integrations → Writing & images.'],
  ['claude', 'Claude Code', 'Anthropic’s agent CLI in a sandbox, on your Claude subscription or an Anthropic key.'],
  ['codex', 'Codex', 'OpenAI’s agent CLI in a sandbox, on your ChatGPT subscription or an OpenAI key.'],
  ['gemini', 'Gemini CLI', 'Google’s agent CLI in a sandbox, with your Gemini API key.'],
];

/** The key each agent CLI signs in with. Gemini has no subscription sign-in. */
export const WORKER_KEYS: Record<Exclude<WorkerChoice, 'api'>, Record<'key' | 'subscription', SecretName>> = {
  claude: { key: 'ANTHROPIC_API_KEY', subscription: 'CLAUDE_CODE_OAUTH_TOKEN' },
  codex: { key: 'OPENAI_API_KEY', subscription: 'CODEX_AUTH_JSON' },
  gemini: { key: 'GEMINI_API_KEY', subscription: 'GEMINI_API_KEY' },
};

/** Integrations → Keys: a line under each job-search key on where to get it, or what happens to it. */
export const CAREER_KEY_HELP: Partial<Record<SecretName, string>> = {
  RESEND_API_KEY: 'Sends the job search’s email digest. Create one in your Resend account under API Keys.',
  CLAUDE_CODE_OAUTH_TOKEN: 'Run “claude setup-token” on your computer and paste the token it prints.',
  CODEX_AUTH_JSON:
    'Sign in to Codex with ChatGPT, then paste ~/.codex/auth.json. Codex reads and refreshes this file, so it is copied into each drafting VM, which is discarded afterwards and reaches only OpenAI’s hosts.',
};
