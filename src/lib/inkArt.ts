import type { ImageMetadata } from 'astro';
import path from 'node:path';

/**
 * Line art: dark, near-monochrome ink on a mostly transparent ground. The journal theme inverts it in dark mode
 * (`.ed-ink`) so it stays legible; photos are never inverted. Read at build time from the image file itself, so
 * owners need no flag. Anything unreadable (a remote URL, no sharp at runtime) counts as not ink.
 * ponytail: per-file stats, cached for the process; a CMS flag would only be needed for remote line art.
 */
export interface ImageFacts {
  ink: boolean;
  width?: number;
  height?: number;
}

const cache = new Map<string, Promise<ImageFacts>>();

export function isInkStats(s: { hasAlpha: boolean; alphaMean: number; inkMean: number; inkSpread: number }) {
  return s.hasAlpha && s.alphaMean < 140 && s.inkMean < 110 && s.inkSpread < 40;
}

function filePath(src: ImageMetadata | string): string | null {
  if (typeof src !== 'string') return (src as ImageMetadata & { fsPath?: string }).fsPath ?? null;
  if (/^https?:\/\//.test(src) || !src.startsWith('/')) return null;
  return path.join(process.cwd(), 'public', src);
}

async function read(file: string): Promise<ImageFacts> {
  try {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(file)
      .resize(96, 96, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { hasAlpha, width, height } = await sharp(file).metadata();
    // Colour of the ink, weighted by opacity, so the colour of fully transparent pixels never counts.
    let alpha = 0;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += info.channels) {
      const w = data[i + 3];
      alpha += w;
      for (let c = 0; c < 3; c++) sum[c] += data[i + c] * w;
    }
    const pixels = data.length / info.channels;
    const means = alpha ? sum.map((v) => v / alpha) : [255, 255, 255];
    const ink = isInkStats({
      hasAlpha: Boolean(hasAlpha),
      alphaMean: alpha / pixels,
      inkMean: Math.max(...means),
      inkSpread: Math.max(...means) - Math.min(...means),
    });
    return { ink, width, height };
  } catch {
    return { ink: false };
  }
}

/** Ink or not, plus the intrinsic size of a public/ image (for width/height attributes). */
export function imageFacts(src: ImageMetadata | string | undefined | null): Promise<ImageFacts> {
  const file = src ? filePath(src) : null;
  if (!file) return Promise.resolve({ ink: false });
  let hit = cache.get(file);
  if (!hit) cache.set(file, (hit = read(file)));
  return hit;
}

export async function isInkArt(src: ImageMetadata | string | undefined | null): Promise<boolean> {
  return (await imageFacts(src)).ink;
}
