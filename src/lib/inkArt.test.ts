import type { ImageMetadata } from 'astro';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isInkArt, isInkStats } from './inkArt';

test('isInkStats: dark monochrome ink on a mostly transparent ground', () => {
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 30, inkMean: 43, inkSpread: 22 }), true);
  assert.equal(isInkStats({ hasAlpha: false, alphaMean: 255, inkMean: 43, inkSpread: 22 }), false, 'opaque photo');
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 250, inkMean: 43, inkSpread: 22 }), false, 'opaque fill');
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 30, inkMean: 230, inkSpread: 10 }), false, 'light ink');
  assert.equal(isInkStats({ hasAlpha: true, alphaMean: 30, inkMean: 200, inkSpread: 150 }), false, 'colourful');
});

test('isInkArt: the demo line art is ink; remote URLs and missing files are not', async () => {
  assert.equal(await isInkArt('/images/hero-figure.webp'), true);
  assert.equal(await isInkArt('/images/og-default.jpg'), false);
  assert.equal(await isInkArt('https://example.com/a.png'), false);
  assert.equal(await isInkArt('/images/missing.webp'), false);
  assert.equal(await isInkArt(undefined), false);
});

test('isInkArt: a bundled image read where the build ran is found beside the function instead', async () => {
  const built = { fsPath: '/vercel/path0/src/assets/images/news-art/ink/award.webp' } as unknown as ImageMetadata;
  assert.equal(await isInkArt(built), true);
});
