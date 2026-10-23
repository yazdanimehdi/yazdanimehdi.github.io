// The reading digest by email, through the job search's Resend key (resend.ts).
import { readConfig } from '../admin/content';
import { PostgresStore } from '../admin/postgres-store';
import { DEFAULT_FROM, esc, sendEmail } from '../admin/resend';
import { getSecret } from '../admin/secrets';
import { adminSettings } from '../admin/settings';
import { visible } from '../career/text';
import type { Sql } from '../db';
import { listDigests, readReading } from './db';
import { parseReadingPrefs } from './settings';
import type { DigestItem, DigestSection } from './types';

const SECTIONS: [DigestSection, string][] = [
  ['talked', 'People are talking about'],
  ['field', 'New in your field'],
  ['unranked', 'Not ranked tonight'],
];

/**
 * The day's digest: each section's titles with their lines, and a link to the reading page. Null when it holds
 * nothing. Titles and lines come from third parties (and the AI), so they are cleaned and the HTML escapes them.
 */
export function readingDigestText(
  day: string,
  items: DigestItem[],
  adminUrl: string,
): { subject: string; text: string; html: string } | null {
  if (!items.length) return null;
  const url = `${adminUrl}/reading`;
  const count = (s: DigestSection) => items.filter((i) => i.section === s).length;
  const talked = count('talked');
  const inField = count('field');
  const parts = [...(talked ? [`${talked} talked about`] : []), ...(inField ? [`${inField} in your field`] : [])];
  // Only unranked papers (the AI stopped early) would leave the subject empty.
  const subject = `Reading: ${parts.join(', ') || `${count('unranked')} not ranked tonight`}`;
  const lists = SECTIONS.map(([s, head]) => ({
    head,
    rows: items.filter((i) => i.section === s).map((i) => ({ title: visible(i.paper.title), line: visible(i.line) })),
  })).filter((l) => l.rows.length);
  const text = [
    `Your reading for ${day}`,
    ...lists.map((l) => [l.head, ...l.rows.map((r) => `- ${r.title}\n  ${r.line}`)].join('\n')),
    `Open it: ${url}`,
  ].join('\n\n');
  const html = [
    `<p>Your reading for ${esc(day)}</p>`,
    ...lists.map(
      (l) =>
        `<h3>${esc(l.head)}</h3><ul>${l.rows.map((r) => `<li>${esc(r.title)}<br>${esc(r.line)}</li>`).join('')}</ul>`,
    ),
    `<p><a href="${esc(url)}">Open it</a></p>`,
  ].join('\n');
  return { subject, text, html };
}

/**
 * Sends the day's digest: 'sent'; 'skipped' when the email is off, there's no RESEND_API_KEY, no address (`email.to`,
 * else the CV's email) or no items; otherwise Resend's error. Never throws: an email problem must not fail the run.
 */
export async function sendReadingDigest(
  sql: Sql,
  day: string,
  fetchFn: typeof fetch = fetch,
): Promise<'sent' | 'skipped' | string> {
  try {
    const { email } = parseReadingPrefs((await readReading(sql)).prefs);
    if (!email.on) return 'skipped';
    const key = await getSecret(sql, 'RESEND_API_KEY');
    if (!key) return 'skipped';
    const store = new PostgresStore(sql, {
      name: 'ScholarOS reading',
      email: 'scholaros-reading@users.noreply.github.com',
    });
    const [site, cv] = await Promise.all([readConfig(store, 'site'), readConfig(store, 'cv')]);
    const cvEmail = (cv.data.cv as { email?: unknown } | undefined)?.email;
    const to = email.to.trim() || (typeof cvEmail === 'string' ? cvEmail.trim() : '');
    if (!to) return 'skipped';
    // listDigests reads days before `before`: the next day's date gives exactly this one.
    const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const [digest] = await listDigests(sql, { before: next, days: 1 });
    const siteUrl = String(site.data.siteUrl ?? '').replace(/\/+$/, '');
    const mail = readingDigestText(
      day,
      digest?.day === day ? digest.items : [],
      `${siteUrl}/${adminSettings().adminPath}`,
    );
    if (!mail) return 'skipped';
    return await sendEmail(key, { from: email.from.trim() || DEFAULT_FROM, to, ...mail }, fetchFn);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reading] digest', e);
    return `The digest failed: ${(e as Error).message}`.slice(0, 300);
  }
}
