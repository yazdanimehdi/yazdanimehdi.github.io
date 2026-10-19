import type { ImageMetadata } from 'astro';
import { getSiteConfig } from '../config';

// ponytail: eager glob emits all 24 originals (~5 MB) into every build; pages reference only the active style's.
const ART = import.meta.glob<ImageMetadata>('/src/assets/images/news-art/*/*.webp', { eager: true, import: 'default' });

/** The built-in art for a news category in the site's newsArt style; 'general' when the category has none. */
export function newsArt(category: string): ImageMetadata {
  const dir = `/src/assets/images/news-art/${getSiteConfig().newsArt}`;
  return ART[`${dir}/${category}.webp`] ?? ART[`${dir}/general.webp`];
}

/** News entries without an image of their own get their category's art, so every view (lists, detail, og) has one. */
export function withNewsArt<T extends { data: { category: string; image?: unknown } }>(entries: T[]): T[] {
  return entries.map((e) => (e.data.image ? e : { ...e, data: { ...e.data, image: newsArt(e.data.category) } }));
}
