import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanMarkdown,
  figurePrompt,
  imagePrompt,
  paperPostPrompt,
  parsePaperPost,
  rewritePrompt,
  writePrompt,
} from './prompts';

test('writePrompt: title, subtitle, instruction and existing notes all reach the model; Markdown-only rules in system', () => {
  const p = writePrompt({
    collection: 'posts',
    title: 'Sparse attention',
    subtitle: 'Why it works',
    instruction: 'Keep it short',
    body: 'idea: $O(n)$',
  });
  assert.match(p.prompt, /blog post/);
  assert.match(p.prompt, /Title: Sparse attention/);
  assert.match(p.prompt, /Subtitle: Why it works/);
  assert.match(p.prompt, /Instructions: Keep it short/);
  assert.match(p.prompt, /Notes to build on[\s\S]*idea: \$O\(n\)\$/);
  assert.match(p.system, /no front matter/);
  assert.doesNotMatch(writePrompt({ collection: 'announcements', title: 'T' }).prompt, /Notes|Subtitle|Instructions/);
  assert.match(writePrompt({ collection: 'announcements', title: 'T' }).prompt, /news item/);
});

test('rewritePrompt: the body and instruction go in; "tighten and clarify" by default; math stays intact by rule', () => {
  const p = rewritePrompt({ collection: 'posts', body: 'Old $x$ body', instruction: 'More formal' });
  assert.match(p.prompt, /Instructions: More formal/);
  assert.match(p.prompt, /Body:\n\nOld \$x\$ body/);
  assert.match(p.system, /math \(\$…\$\)/);
  assert.match(rewritePrompt({ collection: 'posts', body: 'b' }).prompt, /Tighten and clarify/);
});

test('cleanMarkdown: strips one wrapping fence and front matter, keeps inner fences', () => {
  assert.equal(cleanMarkdown('```markdown\nHello **x**\n```'), 'Hello **x**\n');
  assert.equal(cleanMarkdown('---\ntitle: X\n---\nBody'), 'Body\n');
  const inner = 'Text\n\n```py\nprint(1)\n```\n\nMore';
  assert.equal(cleanMarkdown(inner), `${inner}\n`);
});

test('imagePrompt: names the title and forbids text, logos and real faces', () => {
  const p = imagePrompt({ title: 'Robots that learn', excerpt: 'A summary' });
  assert.match(p, /"Robots that learn"/);
  assert.match(p, /About: A summary/);
  assert.match(p, /No text/);
  assert.match(p, /logos/);
  assert.match(p, /faces of real people/);
});

test('figurePrompt: the title and abstract go in; a journal-style figure without text or real faces', () => {
  const p = figurePrompt({ title: 'Sparse attention', abstract: 'We show attention can be sparse.' });
  assert.match(p, /"Sparse attention"/);
  assert.match(p, /Abstract: We show attention can be sparse\./);
  assert.match(p, /journal-style/);
  assert.match(p, /No text/);
  assert.match(p, /faces of real people/);
  assert.doesNotMatch(figurePrompt({ title: 'T' }), /Abstract/);
});

test('paperPostPrompt: paper details in, JSON shape requested; abstract optional', () => {
  const paper = { title: 'P', authors: ['A Chen', 'J Smith'], venue: 'NeurIPS', year: 2026, abstract: 'We show X.' };
  const p = paperPostPrompt(paper);
  assert.match(p.prompt, /Authors: A Chen, J Smith/);
  assert.match(p.prompt, /Venue: NeurIPS \(2026\)/);
  assert.match(p.prompt, /Abstract: We show X\./);
  assert.match(p.prompt, /"tags": string\[\]/);
  assert.match(paperPostPrompt({ ...paper, abstract: undefined }).prompt, /No abstract is available/);
});

test('parsePaperPost: JSON inside prose or a fence parses; bad JSON or a missing body throws', () => {
  const json = JSON.stringify({
    title: ' Title ',
    subtitle: 'Sub',
    excerpt: '',
    tags: ['ml', 7, 'a', 'b', 'c', 'd', 'e'],
    body: '```\nBody\n```',
  });
  assert.deepEqual(parsePaperPost(`Sure!\n\`\`\`json\n${json}\n\`\`\``), {
    title: 'Title',
    subtitle: 'Sub',
    excerpt: undefined,
    tags: ['ml', 'a', 'b', 'c', 'd'],
    body: 'Body\n',
  });
  assert.throws(() => parsePaperPost('no json here'), /did not return the JSON/);
  assert.throws(() => parsePaperPost('{"title": "x"}'), /no title or body/);
});
