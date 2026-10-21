import { readConfig } from '../../../../../lib/admin/content';
import { assertPublisher } from '../../../../../lib/admin/editor';
import { HttpError, commitChanges, json, readBody, route } from '../../../../../lib/admin/http';
import { PathError, THEMES_DIR, THEME_NAME, configPath } from '../../../../../lib/admin/paths';
import type { Change, ContentStore } from '../../../../../lib/admin/store';
import { assertThemeFiles, parseStyles, themeFilePath } from '../../../../../lib/cv-styles';
import type { CvConfig } from '../../../../../lib/types';

export const prerender = false;

function themeName(name: unknown): string {
  if (typeof name !== 'string' || !THEME_NAME.test(name))
    throw new PathError('A theme name is lowercase letters and digits');
  return name;
}

const stored = (store: ContentStore, name: string) => store.list(`${THEMES_DIR}/${name}`);

/** Uploads a custom theme (publishers only: its Jinja templates run in the renderer); replaces the whole folder. */
export const PUT = route(async (ctx, store, user) => {
  assertPublisher(user);
  const name = themeName(ctx.params.name);
  const { files } = await readBody<{ files?: unknown }>(ctx);
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.keys(files).length) {
    throw new HttpError(400, 'files must map at least one template path to its text');
  }
  if (Object.values(files).some((v) => typeof v !== 'string')) throw new HttpError(400, 'Theme files must be text');
  assertThemeFiles(name, files as Record<string, string>);
  const existing = await stored(store, name);
  const changes: Change[] = Object.entries(files as Record<string, string>).map(([rel, content]) => ({
    path: themeFilePath(name, rel),
    content,
  }));
  for (const f of existing) if (!changes.some((c) => c.path === f.path)) changes.push({ path: f.path, content: null });
  const base = Object.fromEntries(existing.map((f) => [f.path, f.version]));
  return json(await commitChanges(store, changes, `Upload CV theme ${name}`, base));
});

/** Removes a custom theme's folder; refused while a style still renders with it. */
export const DELETE = route(async (ctx, store, user) => {
  assertPublisher(user);
  const name = themeName(ctx.params.name);
  const [cv, styles] = await Promise.all([readConfig(store, 'cv'), store.read(configPath('cv-styles'))]);
  const using = parseStyles(styles?.content, cv.data as unknown as CvConfig).styles.filter((s) => s.theme === name);
  if (using.length) {
    throw new HttpError(409, `Used by ${using.map((s) => `"${s.name}"`).join(', ')}: give them another theme first`);
  }
  const existing = await stored(store, name);
  if (!existing.length) throw new HttpError(404, `No theme "${name}"`);
  const changes = existing.map((f) => ({ path: f.path, content: null }));
  const base = Object.fromEntries(existing.map((f) => [f.path, f.version]));
  return json(await commitChanges(store, changes, `Delete CV theme ${name}`, base));
});
