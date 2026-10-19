import type { Directive } from 'vue';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const open = new WeakMap<HTMLElement, { previous: Element | null; onKey: (e: KeyboardEvent) => void }>();
let described = 0;

/**
 * Rendered, and not inside a closed `<details>` other than as its summary: focus() on anything else fails silently,
 * which would stall the Tab cycle on it.
 */
function reachable(x: HTMLElement): boolean {
  for (let d = x.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])') ?? null) {
    if (x.tagName !== 'SUMMARY' || x.parentElement !== d) return false;
  }
  return x.checkVisibility?.() ?? x.getClientRects().length > 0;
}

const focusables = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);

/**
 * `v-dialog` on a modal: keeps Tab / Shift+Tab inside it and gives focus back to the element that had it when the
 * modal unmounts. Esc handling stays with each modal.
 *
 * Initial focus goes to the element marked `data-autofocus`, else the first focusable one. A destructive confirm marks
 * Cancel, and puts Cancel before the action.
 *
 * The dialog is described by its first `<p>` (given an id when it has none), unless it sets `aria-describedby` itself.
 */
export const vDialog: Directive<HTMLElement> = {
  mounted(el) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables(el);
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : at === list.length - 1 ? 0 : at + 1;
      e.preventDefault();
      list[next]?.focus();
    };
    open.set(el, { previous: document.activeElement, onKey });
    document.addEventListener('keydown', onKey);
    const text = el.hasAttribute('aria-describedby') ? null : el.querySelector('p');
    if (text) {
      text.id ||= `adm-dialog-text-${++described}`;
      el.setAttribute('aria-describedby', text.id);
    }
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(el)[0])?.focus();
  },
  unmounted(el) {
    const state = open.get(el);
    if (!state) return;
    document.removeEventListener('keydown', state.onKey);
    (state.previous as HTMLElement | null)?.focus?.();
  },
};
