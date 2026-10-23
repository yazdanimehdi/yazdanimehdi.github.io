import yaml from 'js-yaml';
import { memo, readSiteFile } from './content/context';
import { getMode } from './mode';
import { NIGHT_PALETTES, type NightPalette } from './colors';
import {
  DEFAULT_OFF,
  NEWS_ART_STYLES,
  SITE_PAGES,
  type NewsArtStyle,
  type SiteConfig,
  type HomepageSectionId,
  type HomepageSectionEntry,
  type ThemeName,
  type SitePageId,
} from './types';

let _siteConfig: SiteConfig | null = null;

/**
 * '' or missing → 'classic' (the CMS writes '' for untouched fields, and older forks have no key).
 * 'journal' is the merged theme's name; it is the editorial theme, so both names resolve to 'editorial'.
 * Any other unknown value is a config error.
 */
export function normalizeTheme(value: unknown, source: string): ThemeName {
  if (value === undefined || value === null || value === '') return 'classic';
  if (value === 'journal' || value === 'editorial') return 'editorial';
  if (value === 'classic') return value;
  throw new Error(`${source}: theme must be 'journal' or 'classic', got '${String(value)}'`);
}

/** '' or missing → 'lamplight', the default night palette. Any other unknown value is a config error. */
export function normalizeNight(value: unknown, source: string): NightPalette {
  if (value === undefined || value === null || value === '') return 'lamplight';
  if ((NIGHT_PALETTES as readonly unknown[]).includes(value)) return value as NightPalette;
  throw new Error(`${source}: editorial.night must be one of ${NIGHT_PALETTES.join(', ')}, got '${String(value)}'`);
}

/** '' or missing → the theme's own style (journal: ink plates, classic: flat geometric). Unknown values are a config error. */
export function normalizeNewsArt(value: unknown, theme: ThemeName, source: string): NewsArtStyle {
  if (value === undefined || value === null || value === '') return theme === 'editorial' ? 'ink' : 'geometric';
  if ((NEWS_ART_STYLES as readonly unknown[]).includes(value)) return value as NewsArtStyle;
  throw new Error(`${source}: newsArt must be one of ${NEWS_ART_STYLES.join(', ')}, got '${String(value)}'`);
}

function readConfigFile(filename: string): string {
  const raw = readSiteFile(`config/${filename}`);
  if (raw === null) throw new Error(`config/${filename} not found`);
  return raw;
}

function parseSiteConfig(): SiteConfig {
  const config = yaml.load(readConfigFile('site.yml')) as SiteConfig;
  const envTheme = process.env.SCHOLAROS_THEME;
  config.theme = envTheme
    ? normalizeTheme(envTheme, 'SCHOLAROS_THEME')
    : normalizeTheme(config.theme, 'config/site.yml');
  config.editorial = { ...config.editorial, night: normalizeNight(config.editorial?.night, 'config/site.yml') };
  config.newsArt = normalizeNewsArt(config.newsArt, config.theme, 'config/site.yml');
  // A page that is off leaves the header, the footer index and the sitemap with it.
  if (config.nav) config.nav = config.nav.filter((n) => isPageOn(n.href, config));
  return config;
}

/**
 * False when `path` is a built-in page that `pages` turns off, or under one (/blog/a-post when blog is off).
 * A DEFAULT_OFF page with no setting is off.
 */
export function isPageOn(path: string, config: Pick<SiteConfig, 'pages'> = getSiteConfig()): boolean {
  return !Object.entries(SITE_PAGES).some(
    ([id, href]) =>
      !(config.pages?.[id as SitePageId] ?? !DEFAULT_OFF.includes(id as SitePageId)) &&
      (path === href || path.startsWith(`${href}/`)),
  );
}

export function getSiteConfig(): SiteConfig {
  // Postgres mode: site.yml can change between two requests to one warm function, so cache per request.
  if (getMode() === 'postgres') return memo('config:site', parseSiteConfig);
  return (_siteConfig ??= parseSiteConfig());
}

export function getTheme(): ThemeName {
  return getSiteConfig().theme ?? 'classic';
}

export function isLabMode(): boolean {
  return getSiteConfig().siteMode === 'lab';
}

export function isPersonalMode(): boolean {
  return getSiteConfig().siteMode === 'personal';
}

export function getSiteName(): string {
  const config = getSiteConfig();
  return config.siteMode === 'personal' ? config.author : config.labName;
}

const DEFAULT_HOMEPAGE_SECTIONS: HomepageSectionEntry[] = [
  { id: 'hero', enabled: true },
  { id: 'about', enabled: true },
  { id: 'news', enabled: true },
  { id: 'publications', enabled: true },
  { id: 'blog', enabled: true },
];

export function getHomepageSections(): HomepageSectionId[] {
  const config = getSiteConfig();
  const ids = config.homepageSections?.length
    ? config.homepageSections.filter((s) => s.enabled).map((s) => s.id)
    : // Backward compat: respect about.enabled when homepageSections absent
      DEFAULT_HOMEPAGE_SECTIONS.filter((s) => (s.id === 'about' ? config.about?.enabled !== false : s.enabled)).map(
        (s) => s.id,
      );
  // News and blog items link to their pages, so the sections go when the pages are off.
  return ids.filter((id) => (id !== 'news' && id !== 'blog') || isPageOn(`/${id}`, config));
}

export function getGridColumnCount(): number {
  const sections = getHomepageSections();
  return ['news', 'publications', 'blog'].filter((id) => sections.includes(id as HomepageSectionId)).length;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Recursively convert all object keys from snake_case to camelCase. */
export function normalizeKeys<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => normalizeKeys(item)) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [snakeToCamel(k), normalizeKeys(v)]),
    ) as T;
  }
  return obj;
}

export function loadYamlConfig<T>(filename: string): T {
  return yaml.load(readConfigFile(filename)) as T;
}

/** Feed item ids hidden from the site (`hidden:` in config/feeds.yml). */
export function hiddenFeedIds(): string[] {
  try {
    return loadYamlConfig<{ hidden?: string[] } | null>('feeds.yml')?.hidden ?? [];
  } catch {
    return [];
  }
}
