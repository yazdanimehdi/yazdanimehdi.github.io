import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { toAnimatedWebp } from './animate';
import { AiError } from './providers';

function testMp4(): Uint8Array {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'animate-test-'));
  try {
    const file = path.join(dir, 'clip.mp4');
    execFileSync(
      ffmpegPath!,
      ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', '-pix_fmt', 'yuv420p', file],
      { stdio: 'pipe' },
    );
    return new Uint8Array(readFileSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('toAnimatedWebp: an MP4 becomes a looping animated WebP under 4 MB', async () => {
  const webp = Buffer.from(await toAnimatedWebp(testMp4()));
  assert.equal(webp.toString('latin1', 0, 4), 'RIFF');
  assert.equal(webp.toString('latin1', 8, 12), 'WEBP');
  assert.ok(webp.includes('ANIM'), 'has an ANIM chunk');
  assert.ok(webp.length < 4 * 1024 * 1024);
});

test('toAnimatedWebp: bytes ffmpeg cannot read are an AiError', async () => {
  await assert.rejects(toAnimatedWebp(new Uint8Array([1, 2, 3])), (e) => e instanceof AiError);
});
