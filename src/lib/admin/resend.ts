// Email through Resend's HTTP API (no SDK), shared by the job search's and the reading digests.

export const DEFAULT_FROM = 'ScholarOS <onboarding@resend.dev>';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 'sent', or why not (at most 300 characters). Never throws. */
export async function sendEmail(
  key: string,
  mail: { from: string; to: string; subject: string; text: string; html: string },
  fetchFn: typeof fetch = fetch,
): Promise<'sent' | string> {
  let res: Response;
  try {
    res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...mail, to: [mail.to] }),
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
}
