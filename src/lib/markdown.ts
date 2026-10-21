import {
  createMarkdownProcessor,
  unified,
  type MarkdownHeading,
  type MarkdownRenderer,
} from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import { rehypeExternalLinks } from './rehype-external-links';
import { rehypeMathJaxPassthrough } from './rehype-mathjax-passthrough';

const plugins = { remarkPlugins: [remarkMath], rehypePlugins: [rehypeExternalLinks, rehypeMathJaxPassthrough] };
const shikiConfig = { themes: { light: 'github-light-high-contrast', dark: 'github-dark' } as const };

/** astro.config.mjs `markdown`: content files at build time and Postgres-mode documents at request time render alike.
 * Astro 7 defaults to Sätteri, which runs no remark/rehype plugins, so the unified pipeline is chosen explicitly. */
export const markdownOptions = { processor: unified(plugins), shikiConfig };

let configProcessor: Promise<MarkdownRenderer> | undefined;
let documentProcessor: Promise<MarkdownRenderer> | undefined;

/** Markdown kept in YAML config (bios, research bodies) → HTML, with the same plugins as content files. */
export async function renderMarkdown(md: string | undefined): Promise<string> {
  if (!md?.trim()) return '';
  configProcessor ??= createMarkdownProcessor(plugins);
  const { code } = await (await configProcessor).render(md);
  return code;
}

/** A whole entry body (Postgres mode) → HTML and headings, like astro:content's render(). */
export async function renderMarkdownDocument(md: string): Promise<{ html: string; headings: MarkdownHeading[] }> {
  documentProcessor ??= createMarkdownProcessor({ ...plugins, shikiConfig });
  const { code, metadata } = await (await documentProcessor).render(md);
  return { html: code, headings: metadata.headings };
}
