import type { ImageMetadata } from 'astro';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { isInkArt, isInkStats } from './inkArt';

test('isInkStats: dark monochrome ink on a mostly transparent ground', () => {
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 30, inkMean: 43, inkSpread: 22 }), true);
  assert.equal(isInkStats({ hasAlpha: false, alphaMean: 255, inkMean: 43, inkSpread: 22 }), false, 'opaque photo');
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 250, inkMean: 43, inkSpread: 22 }), false, 'opaque fill');
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 30, inkMean: 230, inkSpread: 10 }), false, 'light ink');
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 30, inkMean: 200, inkSpread: 150 }), false, 'colourful');
});

test('isInkArt: public/ line art is ink, a photo is not; remote URLs and missing files are not', async () => {
  const root = process.cwd();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-art-'));
  fs.mkdirSync(path.join(cwd, 'public/images'), { recursive: true });
  // A dark stroke on a transparent ground, and an opaque colour photo.
  const art = Buffer.alloc(64 * 64 * 4);
  for (let i = 28 * 64 * 4; i < 36 * 64 * 4; i += 4) art.set([30, 30, 30, 255], i);
  await sharp(art, { raw: { width: 64, height: 64, channels: 4 } })
    .webp()
    .toFile(path.join(cwd, 'public/images/art.webp'));
  await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toFile(path.join(cwd, 'public/images/photo.jpg'));
  process.chdir(cwd);
  try {
    assert.equal(await isInkArt('/images/art.webp'), true);
    assert.equal(await isInkArt('/images/photo.jpg'), false);
    assert.equal(await isInkArt('https://example.com/a.png'), false);
    assert.equal(await isInkArt('/images/missing.webp'), false);
    assert.equal(await isInkArt(undefined), false);
  } finally {
    process.chdir(root);
    fs.rmSync(cwd, { recursive: true });
  }
});

test('isInkArt: a bundled image read where the build ran is found beside the function instead', async () => {
  const built = { fsPath: '/vercel/path0/src/assets/images/news-art/ink/award.webp' } as unknown as ImageMetadata;
  assert.equal(await isInkArt(built), true);
});
