<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * A long settings screen as tabs, one section shown at a time, the open one in the URL hash (unknown → the first).
 * `fields`: the error-key prefixes a section owns; a section with a save error shows a dot, and a failed save opens
 * the first such section. Each section's content is the slot named by its id.
 */
const props = defineProps<{
  sections: { id: string; label: string; fields?: string[] }[];
  errors?: Record<string, string>;
}>();
const active = defineModel<string>({ default: '' });
const list = ref<HTMLElement | null>(null);

const hasError = (s: (typeof props.sections)[number]) =>
  Object.keys(props.errors ?? {}).some((k) => s.fields?.some((p) => k.startsWith(p)));
const fromHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  active.value = props.sections.some((s) => s.id === id) ? id : props.sections[0].id;
};
function open(id: string, focus = false) {
  if (id !== active.value) location.hash = id; // a history entry, so Back returns to the previous section
  if (focus) list.value?.querySelector<HTMLElement>(`#adm-tab-${id}`)?.focus();
}
function onKey(e: KeyboardEvent) {
  const rtl = getComputedStyle(list.value!).direction === 'rtl';
  const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  const at = props.sections.findIndex((s) => s.id === active.value);
  const n = props.sections.length;
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : step ? (at + step + n) % n : -1;
  if (to < 0) return;
  e.preventDefault();
  open(props.sections[to].id, true);
}

watch(
  () => props.errors,
  () => {
    const shown = props.sections.find((s) => s.id === active.value);
    const first = props.sections.find(hasError);
    if (first && !(shown && hasError(shown))) open(first.id);
  },
);
// On the narrow tab row, keep the open tab in view.
watch(active, (id) =>
  nextTick(() => list.value?.querySelector(`#adm-tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })),
);
onMounted(() => {
  fromHash();
  addEventListener('hashchange', fromHash);
});
onBeforeUnmount(() => removeEventListener('hashchange', fromHash));
</script>

<template>
  <div class="adm-sections">
    <div ref="list" class="adm-tabs" role="tablist" aria-label="Sections" @keydown="onKey">
      <button
        v-for="s in sections"
        :id="`adm-tab-${s.id}`"
        :key="s.id"
        type="button"
        role="tab"
        :aria-selected="s.id === active"
        :aria-controls="`adm-panel-${s.id}`"
        :tabindex="s.id === active ? 0 : -1"
        @click="open(s.id)"
      >
        {{ s.label
        }}<span v-if="hasError(s)" class="adm-tab-error"><span class="adm-visually-hidden">(has errors)</span></span>
      </button>
    </div>
    <div
      v-if="active"
      :id="`adm-panel-${active}`"
      class="adm-section"
      role="tabpanel"
      :aria-labelledby="`adm-tab-${active}`"
    >
      <slot :name="active" />
    </div>
  </div>
</template>
