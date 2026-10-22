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
  reason?: string;
  /** The exact values the owner approved; submission fills these and nothing else. */
  approved?: { at: string; by: string; fields: ApplyField[] };
  confirmation?: string;
}
