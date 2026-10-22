import type { Application } from './apply/types';

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
  /** Postings the model answered badly three times; they carry `score_error` and aren't retried. */
  failed: number;
  /** Pending postings left for a later night: past the cap, scoring not ready, or the provider failed. */
  deferred: number;
  /** Why scoring was not attempted tonight (no AI key, no CV). */
  scoreSkipped?: string;
  /** The first provider or network error of the night (at most 300 characters); set when an error deferred a posting. */
  scoreError?: string;
  // Runs from before the nightly stages lack the fields below.
  /** The pause switch was on: nothing else ran. */
  paused?: true;
  /** How far the run was set to go: 1 search, 2 + score, 3 + tailor, 4 + pre-fill. */
  stage?: 1 | 2 | 3 | 4;
  /** Drafts that finished (done or needs review). */
  drafted?: number;
  /** Pre-fills that ended ready for approval. */
  prefilled?: number;
  /** Pre-fills that ended in a hand-off. */
  handedOff?: number;
  /** Matches held back tonight by the per-night or per-company limit. */
  limited?: number;
  /** Why drafting or pre-filling stopped early (a quota, a provider error, the worker not set up). */
  stopped?: string;
  /** The email digest: sent, skipped (off, no key, no address, nothing new), or Resend's error. */
  digest?: 'sent' | 'skipped' | string;
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

/** The feed's groups, each with its best rows and its true count. */
export type Feed = Record<'matches' | 'below' | 'gated' | 'unscored', { rows: PostingSummary[]; total: number }>;

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
  application: Application | null;
  applyRunId: string | null;
}
