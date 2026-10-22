import type { Completable, FieldChange, Source } from '../lib/admin/paper-complete';

const SOURCES: Record<Source, string> = {
  arxiv: 'arXiv',
  biorxiv: 'bioRxiv',
  medrxiv: 'medRxiv',
  crossref: 'Crossref',
  pubmed: 'PubMed',
  openalex: 'OpenAlex',
  pdf: 'your PDF',
};

export const sourceLabel = (s?: Source): string => (s ? SOURCES[s] : '');

export const FIELD_LABELS: Record<Completable, string> = {
  title: 'Title',
  authors: 'Authors',
  venue: 'Venue',
  year: 'Year',
  type: 'Type',
  doi: 'DOI',
  arxiv: 'arXiv ID',
  url: 'URL',
  pdf: 'PDF',
  abstract: 'Abstract',
  bibtex: 'BibTeX',
};

/** A value as text: lists comma-joined, nothing as a dash. The field is part of the signature for call-site clarity. */
export function displayValue(_field: Completable, value: unknown): string {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '—';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Empty fields are ticked; changes to what the owner has, and anything read from their PDF, are not. */
export const defaultTicked = (c: FieldChange): boolean => c.fill && c.source !== 'pdf';
