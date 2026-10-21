import { defineComponent, h, type PropType } from 'vue';
import { visible } from './career';
import type { GuardFlags } from '../lib/career/types';

/**
 * The guarded posting text and its guard flags. A render function, not an SFC, so the no-HTML guarantee can be tested
 * without a Vue SFC compiler; h() children are text nodes, never parsed as HTML.
 */
export const PostingText = defineComponent({
  props: { text: { type: String, required: true }, flags: { type: Object as PropType<GuardFlags>, required: true } },
  setup: (props) => () => {
    const f = props.flags;
    const groups: [string, string[]][] = [
      ['Hidden blocks', f.hiddenBlocks],
      ['Hidden URLs', f.hiddenUrls],
      ['Instruction-like lines', f.instructionLines],
      ['Mixed-script words', f.mixedScript],
    ];
    const shown = groups.filter(([, l]) => l.length);
    return h('div', [
      f.warn || shown.length
        ? h('div', { class: 'adm-err', role: 'status' }, [
            h('p', 'This ad contains text aimed at an AI:'),
            ...shown.map(([label, lines]) =>
              h('div', [
                h('strong', label),
                h(
                  'ul',
                  lines.map((l) => h('li', visible(l))),
                ),
              ]),
            ),
          ])
        : null,
      h('div', { class: 'adm-job-text' }, props.text),
    ]);
  },
});
