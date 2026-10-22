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
