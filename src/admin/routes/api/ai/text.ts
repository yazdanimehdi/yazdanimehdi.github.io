import { generateText, readAiConfig } from '../../../../lib/admin/ai';
import { HttpError, json, readBody, route } from '../../../../lib/admin/http';
import { cleanMarkdown, rewritePrompt, writePrompt, type AiCollection } from '../../../../lib/ai/prompts';

export const prerender = false;

// Bounds what one request can send to (and spend at) a provider.
const MAX_CHARS = 100_000;

function field(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `\`${name}\` must be a string`);
  if (value.length > MAX_CHARS)
    throw new HttpError(400, `\`${name}\` is too long for the AI (over ${MAX_CHARS} characters)`);
  return value.trim() || undefined;
}

/** Write or rewrite a post or news body; returns Markdown for the editor, which saves nothing until the owner does. */
export const POST = route(async (ctx, store) => {
  const b = await readBody<Record<string, unknown>>(ctx);
  if (b.collection !== 'posts' && b.collection !== 'announcements') {
    throw new HttpError(400, "`collection` must be 'posts' or 'announcements'");
  }
  const collection: AiCollection = b.collection;
  const [title, subtitle, instruction, body] = ['title', 'subtitle', 'instruction', 'body'].map((k) => field(b[k], k));
  let input;
  if (b.action === 'write') {
    if (!title && !instruction) throw new HttpError(400, 'Give it a title or an instruction first');
    input = writePrompt({ collection, title, subtitle, instruction, body });
  } else if (b.action === 'rewrite') {
    if (!body) throw new HttpError(400, 'There is no text to rewrite yet');
    input = rewritePrompt({ collection, title, instruction, body });
  } else {
    throw new HttpError(400, "`action` must be 'write' or 'rewrite'");
  }
  const text = await generateText(store, await readAiConfig(store), input);
  return json({ text: cleanMarkdown(text) });
});
