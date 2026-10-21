export type PostingStatus =
  | 'found'
  | 'skipped'
  | 'drafted'
  | 'ready'
  | 'submitted'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'no-response'
  | 'withdrawn';

export type DraftState = 'none' | 'running' | 'done' | 'needs-review' | 'failed';

export interface RawPosting {
  source: string;
  externalId: string;
  company: string;
  title: string;
  location?: string;
  remote?: boolean;
  url: string;
  applyUrl?: string;
  description: string;
  format: 'html' | 'text';
  postedAt?: string;
  salary?: { min?: number; max?: number; currency?: string; period?: 'year' | 'month' | 'hour' };
  ats?: { kind: 'greenhouse'; board: string; id: string };
}

export interface GuardFlags {
  hiddenBlocks: string[];
  hiddenUrls: string[];
  invisible: Record<'zero_width' | 'bidi' | 'format' | 'bom', number>;
  invisibleFlagged: number;
  instructionLines: string[];
  mixedScript: string[];
  warn: boolean;
}

export interface RunSummary {
  at: string;
  sources: { id: string; found: number; added: number; error?: string; skipped?: string }[];
  scored: number;
  failed: number;
  deferred: number;
}

export interface PostingSummary {
  id: number;
  company: string;
  title: string;
  location: string | null;
  remote: boolean | null;
  score: number | null;
  gate: string | null;
  status: PostingStatus;
  foundAt: string;
  flagged: boolean;
  draftState: DraftState;
}

export interface Posting {
  id: number;
  key: string;
  source: string;
  externalId: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean | null;
  url: string;
  applyUrl: string | null;
  /** The guarded text. */
  description: string;
  flags: GuardFlags;
  salary: RawPosting['salary'] | null;
  ats: RawPosting['ats'] | null;
  postedAt: string | null;
  foundAt: string;
  lastSeenAt: string;
  gate: string | null;
  score: number | null;
  scoreDetail: unknown;
  scoreError: string | null;
  scoredAt: string | null;
  status: PostingStatus;
  notes: string;
  cv: unknown;
  cvStyle: string | null;
  cvPdfUrl: string | null;
  letter: string | null;
  answers: unknown;
  draftState: DraftState;
  draftIssues: unknown;
  draftRunId: string | null;
}
