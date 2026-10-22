// The nightly email digest, sent through Resend's HTTP API (no SDK).
import { readConfig } from '../admin/content';
import { PostgresStore } from '../admin/postgres-store';
import { getSecret } from '../admin/secrets';
import { adminSettings } from '../admin/settings';
import type { Sql } from '../db';
import { getPosting, readCareer, readyPostings } from './db';
import { parsePrefs } from './settings';
import type { PostingSummary, RunSummary } from './types';

type Row = Pick<PostingSummary, 'id' | 'company' | 'title' | 'score'>;

const FROM = 'ScholarOS <onboarding@resend.dev>';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The digest for a night: its counts, why it stopped (if it did), the postings waiting for approval and tonight's
 * drafts, each linked to its admin page. Null when the night brought nothing new (no draft, pre-fill, hand-off or
 * stop). Titles and companies come from postings, so the HTML escapes them.
 */
export function digestText(
  summary: RunSummary,
  ready: Row[],
  drafted: Row[],
  adminUrl: string,
): { subject: string; text: string; html: string } | null {
  const handedOff = summary.handedOff ?? 0;
  if (!drafted.length && !summary.prefilled && !handedOff && !summary.stopped) return null;
  const link = (r: Row) => `${adminUrl}/career/${r.id}`;
  const readyUrl = `${adminUrl}/career?status=ready`;
  const added = summary.sources.reduce((n, s) => n + s.added, 0);
  const counts = [
    `${added} new`,
    `${summary.scored} scored`,
    `${drafted.length} drafted`,
    ...(summary.prefilled ? [`${summary.prefilled} pre-filled`] : []),
    ...(handedOff ? [`${handedOff} to finish yourself`] : []),
    ...(summary.limited ? [`${summary.limited} held back by your limits`] : []),
  ].join(' · ');
  const subject = [
    ...(ready.length ? [`${ready.length} ready for approval`] : []),
    ...(drafted.length ? [`${drafted.length} drafted`] : []),
    ...(summary.stopped ? ['stopped early'] : []),
  ].join(', ');
  const item = (r: Row) => `${r.company}: ${r.title}${r.score !== null ? ` (${Math.round(r.score)})` : ''}`;
  const lists: [string, Row[]][] = [
    [`Ready for approval (${ready.length})`, ready],
    [`Drafted tonight (${drafted.length})`, drafted],
  ];
  const text = [
    `Tonight's job search: ${counts}`,
    ...(summary.stopped ? [`It stopped early: ${summary.stopped}`] : []),
    ...lists
      .filter(([, rows]) => rows.length)
      .map(([head, rows]) => [head, ...rows.map((r) => `- ${item(r)}\n  ${link(r)}`)].join('\n')),
    ...(ready.length ? [`Review and approve them: ${readyUrl}`] : []),
  ].join('\n\n');
  const html = [
    `<p>Tonight's job search: ${esc(counts)}</p>`,
    ...(summary.stopped ? [`<p><strong>It stopped early:</strong> ${esc(summary.stopped)}</p>`] : []),
    ...lists
      .filter(([, rows]) => rows.length)
      .map(
        ([head, rows]) =>
          `<h3>${esc(head)}</h3><ul>${rows.map((r) => `<li><a href="${esc(link(r))}">${esc(item(r))}</a></li>`).join('')}</ul>`,
      ),
    ...(ready.length ? [`<p><a href="${esc(readyUrl)}">Review and approve them</a></p>`] : []),
  ].join('\n');
  return { subject: `Job search: ${subject}`, text, html };
}

/**
 * Sends the night's digest: 'sent'; 'skipped' when it's off, there's no RESEND_API_KEY, no address (`digest.to`, else
 * the CV's email) or nothing new; otherwise Resend's error. Never throws: a digest problem must not fail the run.
 */
export async function sendDigest(
  sql: Sql,
  summary: RunSummary,
  draftedIds: number[],
  fetchFn: typeof fetch = fetch,
): Promise<'sent' | 'skipped' | string> {
  try {
    const { digest } = parsePrefs((await readCareer(sql)).prefs);
    if (!digest.on) return 'skipped';
    const key = await getSecret(sql, 'RESEND_API_KEY');
    if (!key) return 'skipped';
    const store = new PostgresStore(sql, { name: 'ScholarOS jobs', email: 'scholaros-jobs@users.noreply.github.com' });
    const [site, cv] = await Promise.all([readConfig(store, 'site'), readConfig(store, 'cv')]);
    const cvEmail = (cv.data.cv as { email?: unknown } | undefined)?.email;
    const to = digest.to.trim() || (typeof cvEmail === 'string' ? cvEmail.trim() : '');
    if (!to) return 'skipped';
    const drafted = (await Promise.all(draftedIds.map((id) => getPosting(sql, id)))).filter((p) => !!p);
    const siteUrl = String(site.data.siteUrl ?? '').replace(/\/+$/, '');
    const mail = digestText(summary, await readyPostings(sql), drafted, `${siteUrl}/${adminSettings().adminPath}`);
    if (!mail) return 'skipped';
    let res: Response;
    try {
      res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: digest.from.trim() || FROM, to: [to], ...mail }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      return `Resend could not be reached: ${(e as Error).message}`.slice(0, 300);
    }
    if (res.ok) return 'sent';
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    return `Resend answered ${res.status}: ${typeof body?.message === 'string' ? body.message : res.statusText}`.slice(
      0,
      300,
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[career] digest', e);
    return `The digest failed: ${(e as Error).message}`.slice(0, 300);
  }
}
