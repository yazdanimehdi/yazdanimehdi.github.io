import { generateAnimation, generateImage, readAiConfig, saveImage } from '../../../../lib/admin/ai';
import { HttpError, json, readBody, route } from '../../../../lib/admin/http';
import { figurePrompt, imagePrompt } from '../../../../lib/ai/prompts';
import { slugify } from '../../../../lib/utils';

export const prerender = false;

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : undefined);

/**
 * Generates a cover image or publication figure (`motion`: an animated WebP) and stores it like an upload; the editor
 * puts the returned `url` into the entry.
 */
export const POST = route(async (ctx, store) => {
  const b = await readBody<Record<string, unknown>>(ctx);
  if (b.collection !== 'posts' && b.collection !== 'announcements' && b.collection !== 'publications') {
    throw new HttpError(400, "`collection` must be 'posts', 'announcements' or 'publications'");
  }
  const title = text(b.title);
  let prompt = text(b.prompt);
  if (!prompt && title) {
    prompt =
      b.collection === 'publications'
        ? figurePrompt({ title, abstract: text(b.abstract) })
        : imagePrompt({ title, excerpt: text(b.excerpt) });
  }
  if (!prompt) throw new HttpError(400, 'Give it a title (or a prompt) first');
  const config = await readAiConfig(store);
  const image =
    b.motion === true ? await generateAnimation(store, config, prompt) : await generateImage(store, config, prompt);
  return json(await saveImage(store, slugify(title ?? 'ai-image') || 'ai-image', image));
});
