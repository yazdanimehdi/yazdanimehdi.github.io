import { parse } from 'yaml';
import { PathError, SEGMENT, THEMES_DIR, THEME_NAME } from './admin/paths';
import type { ContentStore } from './admin/store';
import type { CvConfig, CvStyle, CvStylesConfig, Density } from './types';

export type { CvStyle, CvStylesConfig, Density };

export const BUILT_IN_THEMES = [
  'classic',
  'sb2nov',
  'engineeringresumes',
  'moderncv',
  'engineeringclassic',
  'harvard',
  'ink',
  'opal',
  'ember',
] as const;

const DENSITIES: Density[] = ['compact', 'normal', 'airy'];
const STYLE_ID = /^[a-z0-9-]{1,40}$/;
const MAX_FILES = 40;
const MAX_BYTES = 512 * 1024;
const PAGE_SIZES: Record<string, string> = { LETTER: 'us-letter', A4: 'a4' };

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const camelToSnake = (k: string) =>
  k
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

/** Keys camelCase → snake_case, recursively (`convert_keys` in cvrender.py). */
function snakeKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(snakeKeys);
  if (!isMap(v)) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [camelToSnake(k), snakeKeys(x)]));
}

/** The styles to start from when config/cv-styles.yml is missing: same rules as `default_styles` in cvrender.py. */
export function defaultStyles(cv: CvConfig): CvStylesConfig {
  // Import YAML and the Actions upload sync store design keys camelCase; RenderCV's are snake_case.
  const { theme, ...design } = snakeKeys({ ...cv.design }) as Record<string, unknown>;
  const size = PAGE_SIZES[(cv.pdf?.pageSize ?? '').toUpperCase()];
  if (size) design.page = { size, ...(isMap(design.page) ? design.page : {}) };
  const custom = Object.keys(cv.design ?? {}).some((k) => k !== 'theme');
  const style: CvStyle = {
    id: custom ? 'my-style' : 'compact',
    name: custom ? 'My style' : 'Compact',
    theme: (theme as string) || 'classic',
    density: custom ? 'normal' : 'compact',
    design,
  };
  return { public: style.id, styles: [style] };
}

/** A style's design: a mapping, YAML text (Sveltia's code field) or missing (`{}`); null when it is anything else. */
function styleDesign(design: unknown): Record<string, unknown> | null {
  if (design == null || design === '') return {};
  if (typeof design === 'string') {
    try {
      design = parse(design) ?? {};
    } catch {
      return null;
    }
  }
  return isMap(design) ? design : null;
}

export function parseStyles(text: string | undefined, cv: CvConfig): CvStylesConfig {
  let raw: unknown;
  try {
    raw = text ? parse(text) : undefined;
  } catch {
    return defaultStyles(cv);
  }
  const list: unknown[] = isMap(raw) && Array.isArray(raw.styles) ? raw.styles : [];
  const seen = new Set<string>();
  const styles = list.flatMap((s): CvStyle[] => {
    if (!isMap(s)) return [];
    const design = styleDesign(s.design);
    if (
      !design ||
      typeof s.id !== 'string' ||
      !STYLE_ID.test(s.id) ||
      !DENSITIES.includes(s.density as Density) ||
      typeof s.name !== 'string' ||
      typeof s.theme !== 'string' ||
      seen.has(s.id)
    )
      return [];
    seen.add(s.id);
    return [{ ...s, id: s.id, name: s.name, theme: s.theme, density: s.density as Density, design }];
  });
  if (!styles.length) return defaultStyles(cv);
  const pub = (raw as Record<string, unknown>).public;
  return { public: styles.some((s) => s.id === pub) ? (pub as string) : styles[0].id, styles };
}

/** Rejects a custom theme the renderer would refuse or that could escape its folder; the API answers 400. */
export function assertThemeFiles(name: string, files: Record<string, string>): void {
  if (!THEME_NAME.test(name)) throw new PathError('A theme name is lowercase letters and digits');
  if ((BUILT_IN_THEMES as readonly string[]).includes(name)) throw new PathError(`"${name}" is a built-in theme`);
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) throw new PathError(`A theme has at most ${MAX_FILES} files`);
  let bytes = 0;
  for (const [rel, text] of entries) {
    if (!rel.endsWith('.typ') || !rel.split('/').every((s) => SEGMENT.test(s))) {
      throw new PathError(`Invalid theme file: ${rel}`);
    }
    bytes += Buffer.byteLength(text);
  }
  if (bytes > MAX_BYTES) throw new PathError('A theme is at most 512 KB');
}

export const themeFilePath = (name: string, rel: string) => `${THEMES_DIR}/${name}/${rel}`;

/** A custom theme's files, keyed by path relative to its folder. */
export async function readThemeFiles(store: ContentStore, name: string): Promise<Record<string, string>> {
  const dir = `${THEMES_DIR}/${name}`;
  const out: Record<string, string> = {};
  for (const { path } of await store.list(dir)) {
    const file = await store.read(path);
    if (file) out[path.slice(dir.length + 1)] = file.content;
  }
  return out;
}
