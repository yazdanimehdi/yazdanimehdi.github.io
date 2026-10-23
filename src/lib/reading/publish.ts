// The published copy of a public note: front matter for the site, and a body with no private note's title in it.
import { stringify } from 'yaml';
import { pidLabel } from '../../admin/reading-room';
import { PUBLIC_HIGHLIGHTS_MAX, PUBLIC_QUOTE_MAX } from './limits';
import { linkKey, mapLinks, wikiLinks } from './vault-links';

export interface PublicNote {
  uid: string;
  kind: 'paper' | 'free';
  title: string; // the vault title: the [[link]] target
  body: string; // the owner's Markdown
  slug: string;
  sharedAt: string; // public_at
  updatedAt: string;
  paper?: {
    title: string;
    authors: string[];
    url: string;
    arxiv: string | null;
    doi: string | null;
    publishedAt: string | null;
  };
  highlights?: { pid: string; quote: string; comment: string }[]; // the public ones, in listHighlights order
}

export const COPY_DIRS = { paper: 'src/content/readings', free: 'src/content/notes' } as const;

/** A link to a note not in `targets` keeps only its alias, else reads "(private note)". */
export function stripPrivateLinks(body: string, targets: Map<string, string>): string {
  // An alias can hold the pieces of another link (`[[A|[[Secret]]]]`), so repeat until nothing changes. It ends: each
  // private link removed takes a `]` with it, and a public one rebuilt is stable.
  for (;;) {
    const out = mapLinks(body, ({ target, alias, heading, embed }) =>
      targets.has(linkKey(target))
        ? `${embed ? '!' : ''}[[${target}${heading !== null ? `#${heading}` : ''}${alias !== null ? `|${alias}` : ''}]]`
        : alias?.trim() || '(private note)',
    );
    if (out === body) return out;
    body = out;
  }
}

const cut = (q: string) => {
  const cps = [...q];
  return cps.length > PUBLIC_QUOTE_MAX
    ? `${cps
        .slice(0, PUBLIC_QUOTE_MAX - 1)
        .join('')
        .trimEnd()}…`
    : q;
};

/** `targets`: linkKey(title) → uid of every public note. */
export function publishedCopy(n: PublicNote, targets: Map<string, string>): { path: string; content: string } {
  const links = [...new Set(wikiLinks(n.body).flatMap((t) => targets.get(linkKey(t)) ?? []))].filter(
    (uid) => uid !== n.uid,
  );
  const p = n.paper;
  const fm = {
    id: n.uid,
    kind: n.kind === 'paper' ? 'paper' : 'note',
    title: n.title,
    shared: n.sharedAt,
    updated: n.updatedAt,
    links,
    ...(p
      ? {
          paper: {
            title: p.title,
            authors: p.authors,
            url: p.url,
            ...(p.arxiv ? { arxiv: p.arxiv } : {}),
            ...(p.doi ? { doi: p.doi } : {}),
            ...(p.publishedAt ? { published: p.publishedAt } : {}),
          },
        }
      : {}),
    ...(n.kind === 'paper'
      ? {
          highlights: (n.highlights ?? []).slice(0, PUBLIC_HIGHLIGHTS_MAX).map((h) => ({
            quote: cut(stripPrivateLinks(h.quote, targets)),
            where: pidLabel(h.pid),
            ...(h.comment ? { comment: stripPrivateLinks(h.comment, targets) } : {}),
          })),
        }
      : {}),
  };
  return {
    path: `${COPY_DIRS[n.kind]}/${n.slug}.md`,
    content: `---\n${stringify(fm, { lineWidth: 0 })}---\n\n${stripPrivateLinks(n.body, targets)}`,
  };
}
