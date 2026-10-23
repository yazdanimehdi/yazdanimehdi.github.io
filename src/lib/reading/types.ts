export type PaperState = 'new' | 'saved' | 'dismissed';
export type DigestSection = 'talked' | 'field' | 'unranked';

/** Traction numbers, each from a named source; latest values, merged per source. */
export interface Signals {
  /** since: submittedOnDailyAt */
  huggingface?: { upvotes: number; comments: number; since: string };
  /** since: publication_date */
  openalex?: { citations: number; since: string };
  /** visits over the last 7 days */
  alphaxiv?: { visits: number; votes: number };
  /** capped: hit the 100-post page */
  bluesky?: { posts: number; capped: boolean };
}

export interface NewPaper {
  /** 'arxiv:<id>' | 'doi:<lowercase doi>' | 'pmid:<n>' */
  key: string;
  arxiv?: string;
  doi?: string;
  pmid?: string;
  source: string;
  title: string;
  authors: string[];
  abstract?: string;
  url: string;
  publishedAt?: string;
  categories: string[];
  signals?: Signals;
}

export interface Paper extends Required<Pick<NewPaper, 'key' | 'source' | 'title' | 'authors' | 'url' | 'categories'>> {
  id: number;
  arxiv: string | null;
  doi: string | null;
  pmid: string | null;
  abstract: string | null;
  publishedAt: string | null;
  signals: Signals;
  score: number | null;
  reason: string | null;
  related: string | null;
  state: PaperState;
}

export interface DigestItem {
  section: DigestSection;
  rank: number;
  line: string;
  paper: Pick<Paper, 'id' | 'title' | 'authors' | 'source' | 'url' | 'publishedAt' | 'state'>;
}

export interface ReadingRun {
  at: string;
  day: string;
  paused?: true;
  sources: { id: string; found: number; added: number; error?: string; skipped?: string }[];
  ranked: number;
  unranked: number;
  aiCalls: number;
  talked: number;
  inField: number;
  texts: { fetched: number; failed: number };
  stopped?: string;
  /** Why the talked-about list was emptied before the area check could run. */
  talkedSkipped?: 'ranking stopped' | 'AI cap spent';
  email?: 'sent' | 'skipped' | string;
}

// The reading room.
export type TextSource = 'arxiv-html' | 'arxiv-pdf' | 'upload' | 'scan' | 'abstract';

export interface TextState {
  source: TextSource | null;
  error: string | null;
  note: string | null;
  pages: number | null;
}

export interface Passage {
  pid: string;
  kind: 'h2' | 'h3' | 'h4' | 'p' | 'figure';
  body: string;
}

/** pid 'page3' for a scan */
export interface Cite {
  paper: number;
  pid: string;
}

/** mine: one of the owner's papers or areas */
export interface Claim {
  text: string;
  cites: Cite[];
  mine?: string;
}

export type OutputKind = 'summary' | 'briefing' | 'faq' | 'glossary';

export interface OutputBody {
  papers: number[];
  sections: { heading: string; claims: Claim[] }[];
}

export interface Output {
  kind: OutputKind;
  status: 'running' | 'ready' | 'failed';
  body: OutputBody | null;
  error: string | null;
  updatedAt: string;
}

export type Target = { paper: number } | { notebook: number };

/** What a blog draft is written from. */
export type DraftFrom = { paper: number } | { notebook: number } | { note: number } | { papers: number[] };

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  body: string;
  cites: Cite[];
  saved: boolean;
  createdAt: string;
}

export interface Highlight {
  id: number;
  paperId: number;
  pid: string;
  start: number;
  end: number;
  quote: string;
  comment: string;
}

export interface LibraryItem {
  paper: Pick<Paper, 'id' | 'title' | 'authors' | 'source' | 'url' | 'publishedAt' | 'state'>;
  savedAt: string;
}

export type NoteKind = 'paper' | 'chat' | 'free';

/**
 * A saved answer as a chat note keeps it, whatever happens to the chat. askedAt: the answer's time; origin: a paper's
 * chat (cites without surnames, as the room shows them) or a notebook's.
 */
export interface ChatSnapshot {
  question: string;
  answer: string;
  cites: Cite[];
  askedAt: string;
  origin: 'paper' | 'notebook';
}

export interface VaultNote {
  id: number;
  kind: NoteKind;
  title: string;
  body: string;
  paperId: number | null;
  chat: ChatSnapshot | null;
  chatId: number | null;
  notebookId: number | null;
  suggestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRow {
  id: number;
  kind: NoteKind;
  title: string;
  updatedAt: string;
}

/** targetId null: a new concept note */
export interface Suggestion {
  id: number;
  targetId: number | null;
  title: string;
  reason: string;
}
