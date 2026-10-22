export type ApplyKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'file';

export interface ApplyField {
  id: string;
  label: string;
  kind: ApplyKind;
  required: boolean;
  options?: string[];
  value: string;
  source: 'cv' | 'answers' | 'ai' | 'handoff' | 'file' | 'owner';
  note?: string;
}

export type ApplyState =
  | 'prefilling'
  | 'ready'
  | 'handoff'
  | 'approved'
  | 'submitting'
  | 'submitted'
  | 'unconfirmed'
  | 'changed'
  | 'failed';

export interface Application {
  state: ApplyState;
  at: string;
  url: string;
  fields: ApplyField[];
  shots: string[];
  letterPdf?: string;
  /** The tailored CV the pre-fill uploaded; submission uploads this one, not a later re-render. */
  cvPdf?: string;
  reason?: string;
  /** The exact values the owner approved; submission fills these and nothing else. */
  approved?: { at: string; by: string; fields: ApplyField[] };
  confirmation?: string;
}

/** States in which the application may already have gone out: nothing moves it on or sends it again. */
export const MAY_BE_SENT: readonly ApplyState[] = ['submitting', 'submitted', 'unconfirmed'];

/** The input of runner.mjs (see its JSDoc). */
export interface RunnerInput {
  mode: 'read' | 'fill' | 'submit';
  url: string;
  values?: { id: string; value: string }[];
  /** submit: the approved fields; the live form must match them before anything is typed. */
  expect?: ApplyField[];
  /** Absolute paths where the runner runs. */
  files?: { cv?: string; letter?: string };
  /** fill: rendered to letter.pdf and uploaded as the cover letter. */
  letterHtml?: string;
  out: string;
}

export interface RunnerResult {
  ok: boolean;
  url: string;
  fields: ApplyField[];
  blocker?: 'captcha' | 'login' | 'account' | 'no-form';
  /** submit: ids whose shape differs from `expect`. */
  changed?: string[];
  shots: string[];
  letterPdf?: string;
  /** submit: set once the submit control was clicked; false means it may have gone out unconfirmed. */
  confirmed?: boolean;
  error?: string;
}
