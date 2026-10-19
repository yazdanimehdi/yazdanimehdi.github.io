/** The admin's one date vocabulary, in the page language. */
const lang = () => (typeof document === 'undefined' ? '' : document.documentElement.lang) || 'en';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "Oct 9, 2026". A bare YYYY-MM-DD (front matter) is a calendar day, so it is read in UTC, never shifted a day. */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(lang(), {
    dateStyle: 'medium',
    ...(DATE_ONLY.test(value) ? { timeZone: 'UTC' } : {}),
  });
}

/** "Oct 9, 2026, 3:04 PM": the absolute time behind a relative one. */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(lang(), { dateStyle: 'medium', timeStyle: 'short' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago", "yesterday", "in 2 days"; under a minute is "now". */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}
