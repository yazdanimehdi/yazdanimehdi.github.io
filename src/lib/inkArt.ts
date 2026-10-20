import type { ImageMetadata } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Line art: dark, near-monochrome ink on a mostly transparent ground. The journal theme inverts it in dark mode
 * (`.ed-ink`) so it stays legible; photos are never inverted. Read at build time from the image file itself, so
 * owners need no flag. Postgres mode renders at request time, so it reads Blob images over the network. Anything
 * unreadable (another remote host, no sharp at runtime) counts as not ink.
 * ponytail: per-file stats, cached for the process; store them with the media row if Blob fetches ever cost.
 */
export interface ImageFacts {
  ink: boolean;
  width?: number;
  height?: number;
}

const cache = new Map<string, Promise<ImageFacts>>();

// Vercel Blob, where Postgres mode keeps every image. No other remote host is fetched.
const BLOB = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

export function isInkStats(s: { hasAlpha: boolean; alphaMean: number; inkMean: number; inkSpread: number }) {
  return s.hasAlpha && s.alphaMean < 140 && s.inkMean < 110 && s.inkSpread < 40;
}

function filePath(src: ImageMetadata | string): string | null {
  if (typeof src !== 'string') {
    const fsPath = (src as ImageMetadata & { fsPath?: string }).fsPath;
    if (!fsPath || fs.existsSync(fsPath)) return fsPath ?? null;
    // fsPath is where the build ran. A Postgres-mode function has the file beside it instead (includeFiles).
    return path.join(process.cwd(), fsPath.slice(fsPath.lastIndexOf('/src/') + 1));
  }
  if (BLOB.test(src)) return src;
  if (/^https?:\/\//.test(src) || !src.startsWith('/')) return null;
  return path.join(process.cwd(), 'public', src);
}

async function read(file: string): Promise<ImageFacts> {
  try {
    const sharp = (await import('sharp')).default;
    const input = BLOB.test(file) ? await download(file) : file;
    const { data, info } = await sharp(input)
      .resize(96, 96, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { hasAlpha, width, height } = await sharp(input).metadata();
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

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
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
