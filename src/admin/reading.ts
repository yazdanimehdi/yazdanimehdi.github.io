import { visible } from '../lib/career/text';
import type { ReadingRun } from '../lib/reading/types';

/** Each source's name as people write it. */
export const SOURCE_NAMES: Record<string, string> = {
  arxiv: 'arXiv',
  biorxiv: 'bioRxiv',
  medrxiv: 'medRxiv',
  pubmed: 'PubMed',
  openalex: 'OpenAlex',
  huggingface: 'Hugging Face',
  bluesky: 'Bluesky',
  alphaxiv: 'alphaXiv',
};

const plural = (n: number) => (n === 1 ? '' : 's');
const papers = (n: number) => `${n} paper${plural(n)}`;

/** The last run in one line: both sections' counts, then what was found and fetched when not zero. */
export function readingRunLine(r: ReadingRun): string {
  if (r.paused) return 'Paused: nothing ran';
  const found = r.sources.reduce((n, s) => n + s.found, 0);
  const more: [number, string][] = [
    [found, 'found'],
    [r.texts.fetched, 'texts fetched'],
  ];
  return [
    `${r.talked} talked about`,
    `${r.inField} in your field`,
    ...more.filter(([n]) => n).map(([n, what]) => `${n} ${what}`),
  ].join(' · ');
}

/** What went wrong in the last run, one line each, its third-party text cleaned: shown below the run strip. */
export function readingRunNotes(r: ReadingRun): string[] {
  const email = r.email && r.email !== 'sent' && r.email !== 'skipped' ? r.email : null;
  return [
    r.stopped && `Ranking stopped: ${visible(r.stopped)}. The rest are listed as not ranked tonight.`,
    email && `The digest email wasn’t sent: ${visible(email)}`,
    ...r.sources.map((s) => s.error && `${s.id}: ${visible(s.error)}`),
  ].filter((n): n is string => !!n);
}

/**
 * Why a section of the run's digest holds fewer papers than it could: the list is never padded. Null when it is full.
 * When the AI stopped or the night's cap ran out, that is the reason given.
 */
export function thinLine(
  section: 'talked' | 'field',
  count: number,
  max: number,
  area: string,
  run: Pick<ReadingRun, 'stopped' | 'unranked' | 'talkedSkipped'>,
): string | null {
  if (count >= max) return null;
  const where = area || 'your area';
  const cause = (skipped: boolean) => (skipped ? 'Ranking stopped' : 'The night’s AI cap ran out');
  if (section === 'field') {
    if (run.unranked)
      return `${cause(!!run.stopped)} before every new paper was scored. The rest are under Not ranked tonight.`;
    return count
      ? `Only ${count} new paper${plural(count)} scored high enough today.`
      : 'No new paper scored high enough today.';
  }
  if (run.talkedSkipped)
    return `${cause(run.talkedSkipped === 'ranking stopped')} before the check for papers in ${where}, so no talked-about paper is listed.`;
  return count
    ? `Only ${papers(count)} in ${where} had traction numbers from your sources today. The list is not padded.`
    : `No paper in ${where} had traction numbers from your sources today.`;
}

/** Up to three names, then "et al.". */
export function authorsLine(authors: string[]): string {
  const names = authors.slice(0, 3).map(visible).join(', ');
  return authors.length > 3 ? `${names} et al.` : names;
}

/** An earlier day's summary: "Wednesday 21 October · 11 papers". */
export function dayLine(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `${date} · ${papers(count)}`;
}
