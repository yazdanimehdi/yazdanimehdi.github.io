import { reactive } from 'vue';
import type { AdminCtx, CommitResult } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type ToastAction = { label: string; run: () => void };
export interface Toast {
  id: number;
  text: string;
  href?: string;
  action?: ToastAction;
  /** Errors render in the assertive live region and stay until dismissed. */
  error?: boolean;
}
export const toasts = reactive<Toast[]>([]);
let lastToast = 0;
const INFO_MS = 8000;

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/**
 * A notice in the corner. Plain notices leave after 8 s; a notice with a link (View commit) or an action (Undo, Retry)
 * stays until dismissed, so nobody has to beat a timer to use it (WCAG 2.2.1).
 */
export function toast(text: string, href?: string, action?: ToastAction): void {
  const id = ++lastToast;
  toasts.push({ id, text, href, action });
  if (!action && !href) setTimeout(() => dismissToast(id), INFO_MS);
}

/** A failure: announced assertively, kept until dismissed. `action` offers the recovery, e.g. Retry. */
export function toastError(text: string, action?: ToastAction): void {
  toasts.push({ id: ++lastToast, text, action, error: true });
}

/**
 * Set by AdminShell from the page context and `me`; `outage` is the persistent "database unreachable" banner,
 * `careerReady` the job-search owner's count of postings waiting for approval (null: not the owner, or not known yet).
 */
export const session = reactive({ mode: 'git' as AdminCtx['mode'], outage: '', careerReady: null as number | null });

export function committed(result: Pick<CommitResult, 'url' | 'warning' | 'tags' | 'detail'>): void {
  if (result.warning === 'cache-purge-failed') {
    const tags = result.tags ?? [];
    return toastError('Published, but the page cache could not be refreshed: visitors may see the old version.', {
      label: 'Retry refresh',
      run: () => void api('cache/purge', { body: { tags } }).then(() => toast('Cache refreshed'), report),
    });
  }
  if (result.warning === 'pdf-failed')
    return toastError(`Saved; PDF generation failed: ${result.detail ?? 'unknown error'}`);
  if (session.mode === 'postgres') return toast('Published');
  toast('Committed · live in about a minute', result.url);
}

/** A toast for any failure, listing field errors or import problems when the API sent them. */
export function report(e: unknown): void {
  if (e instanceof ApiError && Array.isArray(e.details)) return toastError(`${e.message}: ${e.details.join('; ')}`);
  if (e instanceof ApiError && e.status === 400 && e.details && typeof e.details === 'object') {
    const fields = Object.entries(e.details as Record<string, string>).map(([k, v]) => `${k}: ${v}`);
    return toastError(`${e.message} (${fields.join('; ')})`);
  }
  toastError(e instanceof Error ? e.message : String(e));
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData | Blob } = {}, // a Blob is sent as the raw body
): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  // The session ended: reloading lets the middleware send the page to the login screen.
  if (res.status === 401) location.reload();
  if (res.status === 503) session.outage = data?.error ?? 'The database is unreachable.';
  else if (res.ok) session.outage = '';
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.details);
  return data as T;
}
