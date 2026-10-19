import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';

export interface ResolvedImage {
  src: string;
  srcset?: string;
  width?: number;
  height?: number;
}

/**
 * An optimized image: build-time ImageMetadata (static/git) or a URL (Postgres mode: Vercel Blob, optimized by
 * /_vercel/image). Other strings (public/ paths) are served as they are. Never upscales a build-time image; the
 * returned width/height reserve layout space (for URLs they come from the size probe getImage already made).
 */
export async function resolveImage(
  src: ImageMetadata | string,
  width: number,
  widths?: number[],
): Promise<ResolvedImage> {
  if (typeof src === 'string' && !/^https?:\/\//.test(src)) return { src };
  const remote = typeof src === 'string';
  const img = await getImage({ src, width: remote ? width : Math.min(width, src.width), widths, inferSize: remote });
  const { width: w, height: h } = img.attributes;
  return {
    src: img.src,
    srcset: img.srcSet.attribute || undefined,
    width: w === undefined ? undefined : Number(w),
    height: h === undefined ? undefined : Number(h),
  };
}

/** The `sizes` for a detail-page cover: full width on phones, the 680px article column otherwise. */
export const COVER_SIZES = '(max-width: 760px) 100vw, 680px';

/** A detail-page cover (post, news entry, project): the likely LCP image, so responsive and high priority. */
export const resolveCover = (src: ImageMetadata | string) => resolveImage(src, 1360, [480, 800, 1360]);
