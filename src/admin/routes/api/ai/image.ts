import { generateImage, readAiConfig, saveImage } from '../../../../lib/admin/ai';
import { HttpError, json, readBody, route } from '../../../../lib/admin/http';
import { imagePrompt } from '../../../../lib/ai/prompts';
import { slugify } from '../../../../lib/utils';

export const prerender = false;

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : undefined);

/** Generates a cover image and stores it like an upload; the editor puts the returned `url` into the entry. */
export const POST = route(async (ctx, store) => {
  const b = await readBody<Record<string, unknown>>(ctx);
  if (b.collection !== 'posts' && b.collection !== 'announcements') {
    throw new HttpError(400, "`collection` must be 'posts' or 'announcements'");
  }
  const title = text(b.title);
  const prompt = text(b.prompt) ?? (title ? imagePrompt({ title, excerpt: text(b.excerpt) }) : undefined);
  if (!prompt) throw new HttpError(400, 'Give it a title (or a prompt) first');
  const image = await generateImage(store, await readAiConfig(store), prompt);
  return json(await saveImage(store, slugify(title ?? 'ai-image') || 'ai-image', image));
});
