import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { MAX_UPLOAD } from '../admin/media';
import { AiError } from './providers';

/** The second try is smaller and coarser, for clips whose first encoding misses the upload cap. */
const ATTEMPTS = [
  { width: 480, quality: 70 },
  { width: 360, quality: 50 },
];

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-500)));
    child.on('error', (e) => reject(new AiError(`ffmpeg could not start: ${e.message}`)));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new AiError(`ffmpeg failed (${code}): ${stderr.trim().split('\n').pop()}`)),
    );
  });
}

/** An MP4 as a looping animated WebP under the 4 MB upload cap. */
export async function toAnimatedWebp(mp4: Uint8Array): Promise<Uint8Array> {
  if (!ffmpegPath) throw new AiError('ffmpeg-static has no binary for this platform');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-animate-'));
  try {
    const input = path.join(dir, 'in.mp4');
    const output = path.join(dir, 'out.webp');
    await writeFile(input, mp4);
    for (const { width, quality } of ATTEMPTS) {
      await ffmpeg([
        '-y',
        '-i',
        input,
        '-vf',
        `fps=12,scale=${width}:-2:flags=lanczos`,
        '-loop',
        '0',
        '-c:v',
        'libwebp',
        '-quality',
        String(quality),
        '-an',
        output,
      ]);
      const webp = await readFile(output);
      if (webp.length <= MAX_UPLOAD) return new Uint8Array(webp);
    }
    throw new AiError('The animation is over 4 MB even at a smaller size; try again for a calmer clip');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
