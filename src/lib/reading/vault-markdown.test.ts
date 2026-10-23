import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { markdownBlocks } from '../../admin/reading-room';
import type { VaultNote } from './types';
import { generatedMarkdown, labelCites, noteFile, type NoteContext } from './vault-markdown';

const at = (paper: number, pid: string) => ({ paper, pid });
const note = (o: Partial<VaultNote>): VaultNote => ({
  id: 5,
  kind: 'free',
  title: 'T',
  body: '',
  paperId: null,
  chat: null,
  chatId: null,
  notebookId: null,
  suggestedAt: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '2026-10-21T09:30:00.000Z',
  uid: '00000000-0000-4000-8000-000000000005',
  public: false,
  publicSlug: null,
  publicAt: null,
  ...o,
});
const paperNote = note({ kind: 'paper', title: 'Attention Is All You Need', paperId: 12, body: 'mine' });
const paperCtx: NoteContext = {
  paper: {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    url: 'https://arxiv.org/abs/1706.03762',
    arxiv: '1706.03762',
    doi: null,
    publishedAt: '2017-06-12',
  },
  summary: {
    papers: [12],
    sections: [
      {
        heading: 'Summary',
        claims: [
          { text: 'A model of attention alone.', cites: [at(12, 'abs.1')] },
          { text: 'It trains fast.', cites: [at(12, 'S2.p3')] },
        ],
      },
      { heading: 'What they did', claims: [{ text: 'They built the Transformer.', cites: [at(12, 'S3.SS1.p1')] }] },
      { heading: 'What they found', claims: [{ text: 'It beats RNNs.', cites: [at(12, 'S6.T2'), at(12, 'S6.p1')] }] },
      { heading: 'Why it matters', claims: [{ text: 'Attention scales.', cites: [] }] },
      {
        heading: 'How it relates to your work',
        claims: [{ text: 'Your parser could use it.', cites: [at(12, 'S2.p3')], mine: 'Neural parsing' }],
      },
    ],
  },
  highlights: [
    { pid: 'S2.p3', quote: 'short quote', comment: 'my comment' },
    { pid: 'abs.1', quote: 'another', comment: '' },
  ],
  authors: new Map(),
};

const PAPER_MD = `# Attention Is All You Need

Ashish Vaswani, Noam Shazeer · 2017-06-12 · Source: https://arxiv.org/abs/1706.03762

## Summary

A model of attention alone. (Abstract) It trains fast. (§2 ¶3)

## Key findings

- **What they did:** They built the Transformer. (§3.1 ¶1)
- **What they found:** It beats RNNs. (Table 2; §6 ¶1)
- **Why it matters:** Attention scales. (background)

## How it relates to your work

- Your parser could use it. (§2 ¶3) (your work: Neural parsing)

## Highlights

- “short quote” (§2 ¶3) — my comment
- “another” (Abstract)`;

test('a paper note holds its summary, findings and highlights', () => {
  const md = generatedMarkdown(paperNote, paperCtx);
  assert.equal(md, PAPER_MD);
  const blocks = markdownBlocks(md);
  assert.deepEqual(
    blocks.map((b) => b.t),
    ['h', 'p', 'h', 'p', 'h', 'ul', 'h', 'ul', 'h', 'ul'],
  );
  // No summary, no highlights, no date: only the title and what is known.
  const bare = { ...paperCtx, summary: null, highlights: [], paper: { ...paperCtx.paper!, publishedAt: null } };
  assert.equal(
    generatedMarkdown(paperNote, bare),
    '# Attention Is All You Need\n\nAshish Vaswani, Noam Shazeer · Source: https://arxiv.org/abs/1706.03762',
  );
  assert.equal(generatedMarkdown(note({ body: 'x' }), { authors: new Map() }), '');
});

test("a chat note's cites read as labels", () => {
  assert.equal(labelCites('A [12:S2.p3, 12:abs.1].'), 'A (§2 ¶3; Abstract).');
  const authors = new Map([[12, { authors: ['Ashish Vaswani'] }]]);
  assert.equal(labelCites('A [12:S2.p3, 12:abs.1].', authors), 'A (Vaswani §2 ¶3; Vaswani Abstract).');
  const chat = note({
    kind: 'chat',
    chat: { question: 'Why?', answer: 'Because [12:S2.p3].', cites: [], askedAt: '', origin: 'notebook' },
  });
  assert.equal(generatedMarkdown(chat, { authors }), '**Question:** Why?\n\nBecause (Vaswani §2 ¶3).');
});

const frontMatter = (text: string) => {
  const m = /^---\n([\s\S]*?\n)---\n\n/.exec(text);
  assert.ok(m, 'front matter block');
  return { fm: parse(m[1]), rest: text.slice(m[0].length) };
};

test('front matter parses back', () => {
  const p = noteFile(paperNote, paperCtx);
  assert.equal(p.path, 'vault/papers/Attention Is All You Need.md');
  assert.deepEqual(p.date, new Date(paperNote.updatedAt));
  const { fm, rest } = frontMatter(p.text);
  assert.deepEqual(fm, {
    id: 5,
    kind: 'paper',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    source: 'https://arxiv.org/abs/1706.03762',
    arxiv: '1706.03762',
    published: '2017-06-12',
    created: '2026-10-20T08:00:00.000Z',
    updated: '2026-10-21T09:30:00.000Z',
  });
  assert.deepEqual(Object.keys(fm), [
    'id',
    'kind',
    'title',
    'authors',
    'source',
    'arxiv',
    'published',
    'created',
    'updated',
  ]);
  assert.equal(rest, `${PAPER_MD}\n\n## Notes\n\nmine`);

  const snap = {
    question: 'What: is X?',
    answer: 'X.',
    cites: [],
    askedAt: '2026-10-19T07:00:00.000Z',
    origin: 'paper' as const,
  };
  const c = noteFile(note({ kind: 'chat', title: 'What is X', chat: snap, body: '  \n' }), { authors: new Map() });
  assert.equal(c.path, 'vault/chats/What is X.md');
  const chat = frontMatter(c.text);
  assert.deepEqual(chat.fm, {
    id: 5,
    kind: 'chat',
    question: 'What: is X?',
    asked: '2026-10-19T07:00:00.000Z',
    created: '2026-10-20T08:00:00.000Z',
    updated: '2026-10-21T09:30:00.000Z',
  });
  assert.equal(chat.rest, '**Question:** What: is X?\n\nX.', 'a blank body adds no Notes');

  const f = noteFile(note({ title: 'Idea', body: 'see [[Attention Is All You Need]]' }), {
    authors: new Map(),
    notebook: 'Transformers',
  });
  assert.equal(f.path, 'vault/notes/Idea.md');
  const free = frontMatter(f.text);
  assert.deepEqual(free.fm, {
    id: 5,
    kind: 'note',
    notebook: 'Transformers',
    created: '2026-10-20T08:00:00.000Z',
    updated: '2026-10-21T09:30:00.000Z',
  });
  assert.equal(free.rest, 'see [[Attention Is All You Need]]');
  assert.equal(frontMatter(noteFile(note({}), { authors: new Map() }).text).fm.notebook, undefined);
});

test('generated text makes no Obsidian links in the file, the owner’s writing does', () => {
  const snap = { question: 'Q', answer: 'See [[X]] and ![[Y]].', cites: [], askedAt: '', origin: 'paper' as const };
  const n = note({ kind: 'chat', title: 'Q', chat: snap, body: 'From [[P]]' });
  assert.match(generatedMarkdown(n, { authors: new Map() }), /See \[\[X\]\] and !\[\[Y\]\]\./);
  const { text } = noteFile(n, { authors: new Map() });
  assert.match(text, /See \\\[\\\[X\]\] and !\\\[\\\[Y\]\]\./);
  assert.ok(text.endsWith('## Notes\n\nFrom [[P]]'));
});
