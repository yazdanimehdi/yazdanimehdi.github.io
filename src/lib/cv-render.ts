import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse } from 'yaml';
import { listEntries, readConfig } from './admin/content';
import { UpstreamError, type ContentStore } from './admin/store';
import { PathError, THEME_NAME, configPath } from './admin/paths';
import { BUILT_IN_THEMES, parseStyles, readThemeFiles, type CvStyle } from './cv-styles';
import type { CvConfig } from './types';

export interface CvRenderRequest {
  cv: unknown;
  upload: { enabled?: boolean; content?: string } | null;
  publications: Record<string, unknown>[];
  author: string;
  style: CvStyle;
  themeFiles: Record<string, string>;
}

/** RenderCV (or the request) refused the CV or style; the message is RenderCV's, for the admin to show. */
export class CvRenderError extends Error {}

const TIMEOUT_MS = 150_000;
let override: ((req: CvRenderRequest) => Promise<Uint8Array>) | null = null;

export function setRendererForTests(fn: ((req: CvRenderRequest) => Promise<Uint8Array>) | null): void {
  override = fn;
}

async function viaService(url: string, body: string): Promise<Uint8Array> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new UpstreamError('SESSION_SECRET is not set');
  const key = createHmac('sha256', secret).update('cv-render').digest('hex');
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, '')}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cv-render-key': key },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new UpstreamError(`CV renderer unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 200) return new Uint8Array(await res.arrayBuffer());
  const message = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
  if (res.status === 422 || res.status === 400) throw new CvRenderError(message ?? 'RenderCV rejected the CV');
  throw new UpstreamError(`CV renderer failed (${res.status})${message ? `: ${message}` : ''}`);
}

function viaCli(body: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['services/cv-render/cli.py'], { timeout: TIMEOUT_MS });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', (e) => reject(new UpstreamError(`Could not run the CV renderer: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve(new Uint8Array(Buffer.concat(out)));
      if (code === 2) return reject(new CvRenderError(err.trim() || 'RenderCV rejected the CV'));
      reject(new UpstreamError(`CV renderer failed (exit ${code}): ${err.trim().slice(-300)}`));
    });
    child.stdin.on('error', () => {}); // the close handler reports a dead child
    child.stdin.end(body);
  });
}

/**
 * PDF bytes for a CV and style: the render service when CV_RENDER_URL is set, else the local CLI. A deployed function
 * (VERCEL_ENV production or preview) never spawns Python; `astro dev` sets VERCEL=1 for the admin but no VERCEL_ENV.
 */
export async function renderCv(req: CvRenderRequest): Promise<Uint8Array> {
  if (override) return override(req);
  const body = JSON.stringify(req);
  const url = process.env.CV_RENDER_URL;
  if (url) return viaService(url, body);
  if (['production', 'preview'].includes(process.env.VERCEL_ENV ?? '')) {
    throw new UpstreamError('CV renderer not configured');
  }
  return viaCli(body);
}

/** Everything the renderer needs, read from the store. With no `style` it is the public one. */
export async function cvRenderRequest(store: ContentStore, style?: CvStyle): Promise<CvRenderRequest> {
  const [cv, upload, site, pubs, stylesFile] = await Promise.all([
    readConfig(store, 'cv'),
    readConfig(store, 'cv-upload'),
    readConfig(store, 'site'),
    listEntries(store, 'publications'),
    store.read(configPath('cv-styles')),
  ]);
  const styles = parseStyles(stylesFile?.content, cv.data as unknown as CvConfig);
  const chosen = style ?? styles.styles.find((s) => s.id === styles.public)!;
  const theme = renderTheme(upload.data as CvRenderRequest['upload'], chosen);
  const custom = !(BUILT_IN_THEMES as readonly string[]).includes(theme);
  // The theme names a folder under cv/themes: never let a client-supplied value reach the store as a path.
  if (custom && !THEME_NAME.test(theme)) throw new PathError(`Invalid theme name: ${theme}`);
  return {
    cv: cv.data,
    upload: upload.data as CvRenderRequest['upload'],
    publications: pubs.map((p) => p.data),
    author: String(site.data.author ?? ''),
    style: chosen,
    themeFiles: custom ? await readThemeFiles(store, theme) : {},
  };
}

/** The theme RenderCV will use: an enabled raw upload's own `design` wins over the style (`build_input`). */
function renderTheme(upload: CvRenderRequest['upload'], style: CvStyle): string {
  const content = upload?.enabled ? (upload.content ?? '').trim() : '';
  let doc: unknown;
  try {
    doc = content ? parse(content) : null;
  } catch {
    return style.theme; // the renderer reports the bad YAML
  }
  if (!doc || typeof doc !== 'object' || !('cv' in doc) || !('design' in doc)) return style.theme;
  const design = (doc as { design: unknown }).design as { theme?: unknown } | null;
  return typeof design?.theme === 'string' ? design.theme : 'classic';
}
