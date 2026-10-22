/* eslint-disable vue/one-component-per-file -- the three text renderers share their cite rendering */
import { defineComponent, h, type PropType, type VNode } from 'vue';
import { visible } from '../lib/career/text';
import type { Claim, Cite, Highlight, Passage } from '../lib/reading/types';
import { citeLabel, markdownBlocks, passageSegments, type Inline } from './reading-room';

// Render functions, not SFCs, so the no-HTML guarantee can be tested without a Vue SFC compiler: h() children are
// text nodes, never parsed as HTML. Paper text and AI answers reach the page only this way.

const citeProps = {
  /** papers by id: given in a notebook, so a cite names its paper's first author */
  papers: { type: Map as PropType<Map<number, { authors: string[] }>>, default: undefined },
  /** '12:S2.p3' ids of the passages in the text now: a cite to any other is shown disabled */
  known: { type: Set as PropType<Set<string>>, required: true as const },
  /** ids of papers that are scans: their page cites are plain text, there is no passage to go to */
  scans: { type: Set as PropType<Set<number>>, required: true as const },
};
type CiteProps = {
  papers?: Map<number, { authors: string[] }>;
  known: Set<string>;
  scans: Set<number>;
};

function citeNodes(cites: Cite[], p: CiteProps, emit: (c: Cite) => void): (VNode | string)[] {
  return cites.flatMap((c, i) => {
    const label = citeLabel(c, p.papers);
    const known = p.known.has(`${c.paper}:${c.pid}`);
    const node = p.scans.has(c.paper)
      ? h('span', { class: 'adm-cite' }, label)
      : h(
          'button',
          {
            type: 'button',
            class: 'adm-cite',
            disabled: !known,
            title: known ? undefined : 'This passage is no longer in the text',
            onClick: () => emit(c),
          },
          label,
        );
    return i ? [' ', node] : [node];
  });
}

function inlineNodes(inl: Inline[], p: CiteProps, emit: (c: Cite) => void): (VNode | string)[] {
  return inl.map((x) =>
    x.t === 'cite'
      ? h('span', { class: 'adm-cites' }, citeNodes(x.cites, p, emit))
      : x.t === 'text'
        ? x.s
        : h(x.t, x.s),
  );
}

/** A chat answer: its Markdown as elements of text nodes, cites as buttons emitting 'cite' with the Cite. */
export const AnswerText = defineComponent({
  props: { body: { type: String, required: true }, ...citeProps },
  emits: { cite: (c: Cite) => !!c },
  setup:
    (props, { emit }) =>
    () => {
      const on = (c: Cite) => emit('cite', c);
      return h(
        'div',
        { class: 'adm-answer' },
        markdownBlocks(visible(props.body)).map((b) =>
          'items' in b
            ? h(
                b.t,
                b.items.map((it) => h('li', inlineNodes(it, props, on))),
              )
            : h(b.t === 'p' ? 'p' : 'h4', inlineNodes(b.inl, props, on)),
        ),
      );
    },
});

/** A summary or study aid: each claim its text and cite buttons, 'Background' when uncited, and 'Your work: …'. */
export const ClaimList = defineComponent({
  props: {
    sections: { type: Array as PropType<{ heading: string; claims: Claim[] }[]>, required: true },
    ...citeProps,
  },
  emits: { cite: (c: Cite) => !!c },
  setup:
    (props, { emit }) =>
    () => {
      const on = (c: Cite) => emit('cite', c);
      return h(
        'div',
        { class: 'adm-claims' },
        props.sections.map((s) =>
          h('section', [
            h('h3', s.heading),
            h(
              'ul',
              s.claims.map((c) =>
                h('li', [
                  c.text,
                  ' ',
                  ...(c.cites.length
                    ? citeNodes(c.cites, props, on)
                    : [h('span', { class: 'adm-muted' }, 'Background')]),
                  c.mine ? h('span', { class: 'adm-muted' }, ` Your work: ${c.mine}`) : null,
                ]),
              ),
            ),
          ]),
        ),
      );
    },
});

/**
 * A paper's passages: each an element `psg-<paperId>-<pid>` (focusable for a cite's jump), its text in an element with
 * data-pid whose textContent highlight offsets count in, highlights as <mark data-hl="<ids>">. Headings sit one level
 * below the page's pane heading. `arxiv`: the arXiv id when the text is arXiv's HTML, so a figure links to it.
 */
export const PaperText = defineComponent({
  props: {
    paperId: { type: Number, required: true },
    passages: { type: Array as PropType<Passage[]>, required: true },
    highlights: { type: Array as PropType<Highlight[]>, required: true },
    arxiv: { type: String as PropType<string | null>, default: null },
    flash: { type: String as PropType<string | null>, default: null },
  },
  setup: (props) => () =>
    h(
      'div',
      { class: 'adm-paper-text' },
      props.passages.map((p) => {
        const attrs = {
          id: `psg-${props.paperId}-${p.pid}`,
          tabindex: -1,
          class: { 'is-flash': props.flash === p.pid },
        };
        const text = passageSegments(
          visible(p.body),
          props.highlights.filter((x) => x.pid === p.pid),
        ).map((seg) => (seg.ids.length ? h('mark', { 'data-hl': seg.ids.join(' ') }, seg.s) : seg.s));
        if (p.kind === 'figure')
          return h('figure', attrs, [
            h('figcaption', { 'data-pid': p.pid }, text),
            props.arxiv
              ? h(
                  'a',
                  {
                    href: `https://arxiv.org/html/${props.arxiv}#${encodeURIComponent(p.pid)}`,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  },
                  'Figure on arXiv',
                )
              : null,
          ]);
        const tag = p.kind === 'p' ? 'p' : `h${Number(p.kind[1]) + 1}`;
        return h(tag, { ...attrs, 'data-pid': p.pid }, text);
      }),
    ),
});
