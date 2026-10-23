import { stringify } from 'yaml';
import { citeLabel, pidLabel } from '../../admin/reading-room';
import { CITE_TOKEN, SUMMARY_HEADINGS } from './room-prompts';
import type { Cite, Claim, Highlight, OutputBody, Paper, VaultNote } from './types';

/** What a note's Markdown shows beside its own fields; gathered for many notes at once by vault-db's noteContexts. */
export interface NoteContext {
  paper?: Pick<Paper, 'title' | 'authors' | 'url' | 'arxiv' | 'doi' | 'publishedAt'>;
  /** the paper's ready summary */
  summary?: OutputBody | null;
  highlights?: Pick<Highlight, 'pid' | 'quote' | 'comment'>[];
  /** the papers a notebook chat note's cites name, for citeLabel's surnames; empty for a paper's chat */
  authors: Map<number, { authors: string[] }>;
  /** a notebook note's notebook title */
  notebook?: string;
}

const labels = (cites: Cite[], authors?: Map<number, { authors: string[] }>) =>
  cites.map((c) => citeLabel(c, authors)).join('; ');

/** Each [12:S2.p3, 12:abs.1] → ' (§2 ¶3; Abstract)', with surnames when `authors` names the paper. */
export function labelCites(text: string, authors?: Map<number, { authors: string[] }>): string {
  return text.replace(CITE_TOKEN, (_, _space: string, ids: string) => {
    const cites = ids
      .split(/[,;]\s*/)
      .map((id) => ({ paper: Number(id.split(':')[0]), pid: id.slice(id.indexOf(':') + 1) }));
    return ` (${labels(cites, authors)})`;
  });
}

const claim = (c: Claim) => `${c.text} (${c.cites.length ? labels(c.cites) : 'background'})`;

/**
 * The part of a note the vault writes: a paper's metadata, summary, findings and highlights, or a chat's question and
 * answer; '' for a free note. Only what markdownBlocks renders (headings, paragraphs, lists, bold).
 */
export function generatedMarkdown(note: VaultNote, c: NoteContext): string {
  if (note.kind === 'chat' && note.chat)
    return `**Question:** ${note.chat.question}\n\n${labelCites(note.chat.answer, c.authors)}`;
  if (note.kind !== 'paper' || !c.paper) return '';
  const p = c.paper;
  const claims = (h: string) => c.summary?.sections.find((s) => s.heading === h)?.claims ?? [];
  const blocks = [
    `# ${p.title}`,
    [p.authors.join(', '), p.publishedAt, `Source: ${p.url}`].filter(Boolean).join(' · '),
  ];
  const section = (heading: string, lines: string[], sep = '\n') => {
    if (lines.length) blocks.push(`## ${heading}`, lines.join(sep));
  };
  section('Summary', claims(SUMMARY_HEADINGS[0]).map(claim), ' ');
  section(
    'Key findings',
    SUMMARY_HEADINGS.slice(1, 4).flatMap((h) => claims(h).map((x) => `- **${h}:** ${claim(x)}`)),
  );
  section(
    'How it relates to your work',
    claims(SUMMARY_HEADINGS[4]).map((x) => `- ${claim(x)}${x.mine ? ` (your work: ${x.mine})` : ''}`),
  );
  section(
    'Highlights',
    (c.highlights ?? []).map((h) => `- “${h.quote}” (${pidLabel(h.pid)})${h.comment ? ` — ${h.comment}` : ''}`),
  );
  return blocks.join('\n\n');
}

const FOLDER = { paper: 'papers', chat: 'chats', free: 'notes' } as const;

/** The note as an Obsidian file: YAML front matter, the generated Markdown, then the owner's writing. */
export function noteFile(note: VaultNote, c: NoteContext): { path: string; text: string; date: Date } {
  const times = { created: note.createdAt, updated: note.updatedAt };
  const p = c.paper;
  const fm =
    note.kind === 'paper'
      ? {
          id: note.id,
          kind: 'paper',
          title: p?.title ?? note.title,
          authors: p?.authors ?? [],
          source: p?.url,
          ...(p?.arxiv ? { arxiv: p.arxiv } : {}),
          ...(p?.doi ? { doi: p.doi } : {}),
          ...(p?.publishedAt ? { published: p.publishedAt } : {}),
          ...times,
        }
      : note.kind === 'chat'
        ? { id: note.id, kind: 'chat', question: note.chat?.question, asked: note.chat?.askedAt, ...times }
        : { id: note.id, kind: 'note', ...(c.notebook ? { notebook: c.notebook } : {}), ...times };
  // A [[…]] inside a paper's title, a claim, a quote or an answer would be a link in Obsidian the owner never made.
  const generated = generatedMarkdown(note, c).replaceAll('[[', '\\[\\[');
  const text = note.kind === 'free' ? note.body : generated + (note.body.trim() ? `\n\n## Notes\n\n${note.body}` : '');
  return {
    path: `vault/${FOLDER[note.kind]}/${note.title}.md`,
    text: `---\n${stringify(fm, { lineWidth: 0 })}---\n\n${text}`,
    date: new Date(note.updatedAt),
  };
}
