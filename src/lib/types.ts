import type { NightPalette } from './colors';

export interface NavItem {
  label: string;
  href: string;
}

export interface SocialLinks {
  email?: string;
  github?: string;
  scholar?: string;
  twitter?: string;
  linkedin?: string;
  orcid?: string;
  mastodon?: string;
  bluesky?: string;
  website?: string;
}

export interface FooterConfig {
  text: string;
  links: NavItem[];
}

// Top bar
export interface TopBarLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface TopBarConfig {
  enabled: boolean;
  text: string;
  links: TopBarLink[];
}

// Hero background
export type HeroBackgroundType = 'image' | 'video' | 'pattern' | 'animation' | 'none';
export type HeroPatternName = 'dots' | 'grid' | 'waves' | 'diagonal' | 'hexagons';
export type HeroAnimationPreset = 'particles' | 'gradient-morph' | 'geometric' | 'wave-lines' | 'custom';

export interface HeroModeConfig {
  bgColor: string;
  bgImage?: string;
}

export interface HeroVideoConfig {
  src: string;
  poster?: string;
}

export interface HeroPatternConfig {
  name: HeroPatternName;
}

export interface HeroAnimationConfig {
  preset: HeroAnimationPreset;
  customScript?: string;
}

export interface HeroConfig {
  type: HeroBackgroundType;
  light: HeroModeConfig;
  dark: HeroModeConfig;
  video?: HeroVideoConfig;
  pattern?: HeroPatternConfig;
  animation?: HeroAnimationConfig;
}

export type SiteDirection = 'ltr' | 'rtl';
export type DefaultTheme = 'light' | 'dark' | 'system';

export type ThemeName = 'classic' | 'editorial';

/** Style of the built-in news category art (src/assets/images/news-art/<style>/<category>.webp). */
export const NEWS_ART_STYLES = ['ink', 'engraving', 'watercolor', 'geometric'] as const;
export type NewsArtStyle = (typeof NEWS_ART_STYLES)[number];

/** The built-in pages an admin can turn off (`pages: { talks: false }` in site.yml), and the URL each lives under. */
export const SITE_PAGES = {
  research: '/research',
  people: '/people',
  publications: '/publications',
  cv: '/cv',
  projects: '/projects',
  news: '/news',
  blog: '/blog',
  talks: '/talks',
  positions: '/positions',
  join: '/join',
  repositories: '/repositories',
  contact: '/contact',
} as const;
export type SitePageId = keyof typeof SITE_PAGES;

export type ImageShape = 'rectangular' | 'circular' | 'oval';

export interface AboutConfig {
  enabled: boolean;
  title?: string;
  text: string;
  image?: string;
}

export interface GitHubConfig {
  username: string;
  stats?: boolean;
  trophies?: boolean;
  showPinnedRepos?: boolean;
  pinnedRepos?: string[];
  statsBaseUrl?: string;
  trophyBaseUrl?: string;
}

export interface AnalyticsConfig {
  googleAnalytics?: string;
  googleTagManager?: string;
  cronitor?: string;
  openpanel?: string;
  pirsch?: string;
  microsoftClarity?: string;
}

export interface Web3FormsConfig {
  accessKey?: string;
}

export interface NewsletterConfig {
  enabled?: boolean;
  accessKey?: string;
  heading?: string;
  text?: string;
}

export type HomepageSectionId = 'hero' | 'about' | 'news' | 'publications' | 'blog';

export interface HomepageSectionEntry {
  id: HomepageSectionId;
  enabled: boolean;
}

export interface SeoConfig {
  keywords?: string;
  /** Default social card for pages that pass no image of their own. */
  ogImage?: string;
  googleSiteVerification?: string;
  bingSiteVerification?: string;
}

export interface FontFamiliesConfig {
  sans?: string;
  serif?: string;
  mono?: string;
}

export interface FontSizesConfig {
  base?: string;
  sm?: string;
  lg?: string;
  h1?: string;
  h2?: string;
  h3?: string;
}

export interface FontsConfig {
  families?: FontFamiliesConfig;
  sizes?: FontSizesConfig;
}

export interface ColorModeConfig {
  primary?: string;
  secondary?: string;
}

export interface BackgroundModeConfig {
  color?: string;
  image?: string;
}

export interface ColorsConfig {
  light?: ColorModeConfig;
  dark?: ColorModeConfig;
}

export interface BackgroundConfig {
  light?: BackgroundModeConfig;
  dark?: BackgroundModeConfig;
}

export interface EditorialFigure {
  image: string;
  alt?: string;
  caption?: string;
}

export interface EditorialConfig {
  eyebrow?: string;
  /** Lab mode's role line under the hero name; unset, it reads department · university. */
  labRole?: string;
  tagline?: string;
  /** Markdown */
  bio?: string;
  figure?: EditorialFigure;
  affiliations?: string[];
  contact?: { heading?: string; text?: string };
  /** Dark-mode palette: 'lamplight' (default), 'inkwell' or 'galley'. */
  night?: NightPalette;
}

export interface SiteConfig {
  siteMode: 'personal' | 'lab';
  theme?: ThemeName;
  editorial?: EditorialConfig;
  title: string;
  description: string;
  author: string;
  labName: string;
  university: string;
  department: string;
  siteUrl: string;
  lang?: string;
  direction?: SiteDirection;
  defaultTheme?: DefaultTheme;
  /** Normalized by getSiteConfig: unset follows the theme (journal → ink, classic → geometric). */
  newsArt?: NewsArtStyle;
  nav: NavItem[];
  socials: SocialLinks;
  footer: FooterConfig;
  topBar?: TopBarConfig;
  hero?: HeroConfig;
  about?: AboutConfig;
  homepageSections?: HomepageSectionEntry[];
  /** Shown beside the name in the header and used as the favicon: a public/ path or, in Postgres mode, a Blob URL. */
  logo?: string;
  /** Built-in pages turned on or off; absent means on. */
  pages?: Partial<Record<SitePageId, boolean>>;
  imageShape?: ImageShape;
  github?: GitHubConfig;
  analytics?: AnalyticsConfig;
  web3forms?: Web3FormsConfig;
  newsletter?: NewsletterConfig;
  seo?: SeoConfig;
  cookieConsent?: boolean;
  fonts?: FontsConfig;
  colors?: ColorsConfig;
  background?: BackgroundConfig;
  adminPath?: string;
  adminUsers?: string[];
  publishers?: string[];
}

export interface Publication {
  id: string;
  title: string;
  authors: string[];
  venue: string;
  year: number;
  doi?: string;
  url?: string;
  pdf?: string;
  bibtex?: string;
  type: 'journal' | 'conference' | 'preprint' | 'workshop' | 'thesis' | 'book-chapter';
  featured?: boolean;
  abstract?: string;
  image?: string;
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  date: string;
  source: string;
  excerpt?: string;
  author?: string;
  tags?: string[];
}

export interface CvEducation {
  institution: string;
  area: string;
  degree: string;
  location?: string;
  startDate: string;
  endDate: string;
  highlights?: string[];
}

export interface CvExperience {
  company: string;
  position: string;
  location?: string;
  startDate: string;
  endDate: string;
  highlights?: string[];
}

export interface CvAward {
  label: string;
  details: string;
}

export interface CvSkill {
  label: string;
  details: string;
}

export interface CvPublication {
  title: string;
  authors: string[];
  journal?: string;
  date: string | number;
  doi?: string;
  url?: string;
}

export interface CvSocialNetwork {
  network: string;
  username: string;
}

export interface CvGenericEntry {
  name?: string;
  location?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  highlights?: string[];
  url?: string;
  label?: string;
  details?: string;
  company?: string;
  position?: string;
  title?: string;
  authors?: string[];
  journal?: string;
  doi?: string;
  [key: string]: unknown;
}

export interface CvSections {
  education?: CvEducation[];
  experience?: CvExperience[];
  publications?: CvPublication[];
  awards?: CvAward[];
  skills?: CvSkill[];
  [key: string]:
    | CvGenericEntry[]
    | CvEducation[]
    | CvExperience[]
    | CvPublication[]
    | CvAward[]
    | CvSkill[]
    | string[]
    | undefined;
}

export interface CvData {
  name: string;
  location?: string;
  email?: string;
  phone?: string;
  website?: string;
  socialNetworks?: CvSocialNetwork[];
  sections: CvSections;
}

export interface CvConfig {
  cv: CvData;
  pdf?: { pageSize?: 'LETTER' | 'A4' };
  design?: {
    theme?: string;
  };
}

export interface CvMetadata {
  lastGenerated: string;
  pdfPath: string;
  pdfSize: number;
}

export type PersonRole =
  | 'pi'
  | 'postdoc'
  | 'phd'
  | 'masters'
  | 'undergrad'
  | 'research-assistant'
  | 'visiting'
  | 'alumni';

export type AnnouncementCategory = 'paper' | 'grant' | 'award' | 'talk' | 'media' | 'general';

export type ProjectStatus = 'active' | 'completed' | 'upcoming';

export type ProjectType = 'software' | 'dataset' | 'benchmark' | 'hardware' | 'other';

export type PositionType = 'phd' | 'postdoc' | 'masters' | 'undergrad' | 'research-assistant' | 'visiting' | 'other';
export type PositionStatus = 'open' | 'closed';
