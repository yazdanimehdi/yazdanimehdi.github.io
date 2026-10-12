import type { TextInput } from './providers';

export type AiCollection = 'posts' | 'announcements';

const KIND: Record<AiCollection, string> = {
  posts: 'a blog post on an academic personal website',
  announcements: 'a short news item on an academic website (a few sentences)',
};

const MARKDOWN_RULES =
  'Reply with the Markdown body only: no front matter, no title heading, no code fence around the whole reply, ' +
  'no preamble. Keep inline math ($…$), display math ($$…$$), links, images and code blocks exactly as written.';

const SYSTEM =
  'You are a careful academic editor. You write clear, plain, accurate prose and never invent results, ' +
  'numbers, citations or quotes that the material does not support.';

const lines = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join('\n\n');

export function writePrompt(input: {
  collection: AiCollection;
  title?: string;
  subtitle?: string;
  instruction?: string;
  body?: string;
}): TextInput {
  return {
    system: `${SYSTEM} ${MARKDOWN_RULES}`,
    prompt: lines(
      `Draft the body of ${KIND[input.collection]}.`,
      input.title && `Title: ${input.title}`,
      input.subtitle && `Subtitle: ${input.subtitle}`,
      input.instruction && `Instructions: ${input.instruction}`,
      input.body?.trim() && `Notes to build on (use them, don't repeat them verbatim):\n\n${input.body}`,
    ),
    maxTokens: input.collection === 'posts' ? 8000 : 2000,
  };
}

export function rewritePrompt(input: {
  collection: AiCollection;
  title?: string;
  instruction?: string;
  body: string;
}): TextInput {
  return {
    system: `${SYSTEM} ${MARKDOWN_RULES}`,
    prompt: lines(
      `Rewrite the body of ${KIND[input.collection]}.`,
      input.title && `Title: ${input.title}`,
      `Instructions: ${input.instruction?.trim() || 'Tighten and clarify. Keep the meaning, structure and voice.'}`,
      `Body:\n\n${input.body}`,
    ),
    maxTokens: input.collection === 'posts' ? 8000 : 2000,
  };
}

/** The model's Markdown with one wrapping code fence and any front matter removed. */
export function cleanMarkdown(text: string): string {
  let out = text.trim();
  const fenced = /^(```|~~~)[\w-]*\n([\s\S]*?)\n\1$/.exec(out);
  if (fenced) out = fenced[2].trim();
  out = out.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return `${out}\n`;
}

export function imagePrompt(input: { title: string; excerpt?: string }): string {
  return lines(
    `An editorial illustration for an article titled "${input.title}".`,
    input.excerpt && `About: ${input.excerpt}`,
    'Calm, modern, conceptual; landscape composition. No text, letters, numbers, logos or watermarks, ' +
      'and no faces of real people.',
  );
}

export interface PaperInput {
  title: string;
  authors: string[];
  venue: string;
  year: number;
  url?: string;
  abstract?: string;
}

export function paperPostPrompt(paper: PaperInput): TextInput {
  return {
    system: SYSTEM,
    prompt: lines(
      'One of the site owner’s papers was just published. Write a blog post about it for a general technical ' +
        'audience: what problem it tackles, the key idea, and why it matters. 400 to 700 words, first person ' +
        'plural ("we"). Use only what the paper details below say.',
      `Title: ${paper.title}`,
      `Authors: ${paper.authors.join(', ')}`,
      `Venue: ${paper.venue} (${paper.year})`,
      paper.url && `Link: ${paper.url}`,
      paper.abstract ? `Abstract: ${paper.abstract}` : 'No abstract is available: stay close to the title.',
      'Reply with one JSON object and nothing else: {"title": string, "subtitle": string, "excerpt": string ' +
        '(one sentence), "tags": string[] (at most 5, lowercase), "body": string (Markdown, no front matter, no ' +
        'title heading)}.',
    ),
    maxTokens: 8000,
  };
}

export interface PaperPost {
  title: string;
  subtitle?: string;
  excerpt?: string;
  tags: string[];
  body: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The paper post the model returned; throws when it isn't the JSON asked for. */
export function parsePaperPost(text: string): PaperPost {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The model did not return the JSON post it was asked for');
  }
  const title = str(raw.title);
  const body = str(raw.body);
  if (!title || !body) throw new Error('The model’s post has no title or body');
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map(str)
        .filter((t): t is string => !!t)
        .slice(0, 5)
    : [];
  return { title, subtitle: str(raw.subtitle), excerpt: str(raw.excerpt), tags, body: cleanMarkdown(body) };
}
