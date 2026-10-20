<template>
  <button
    type="button"
    class="-m-1.5 inline-flex h-11 w-11 items-center justify-center rounded text-[var(--color-surface-500)] transition-colors hover:text-[var(--color-primary-600)] dark:text-dm-muted dark:hover:text-[var(--color-accent-400)]"
    :aria-label="label"
    :title="label"
    @click="cycle"
  >
    <!-- The icon shows what is on screen, as the label says it: sun or moon. -->
    <svg
      v-if="mode === 'light'"
      aria-hidden="true"
      class="h-[18px] w-[18px]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
    <svg
      v-else
      aria-hidden="true"
      class="h-[18px] w-[18px]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

type Mode = 'light' | 'dark' | 'system';
const MODES: Mode[] = ['light', 'dark', 'system'];

/** Already translated: `label` holds `{mode}`, `byDefault` wraps the site default's word. */
const props = defineProps<{ labels: { label: string; byDefault: string; words: Record<'light' | 'dark', string> } }>();

const stored = ref<Mode | null>(null);
const siteDefault = ref<Mode>('system');
const osDark = ref(false);
// What is on screen: the stored choice, else the site default; "system" follows the OS.
const mode = computed<'light' | 'dark'>(() => {
  const preferred = stored.value ?? siteDefault.value;
  return preferred === 'dark' || (preferred === 'system' && osDark.value) ? 'dark' : 'light';
});
const label = computed(() => {
  const word = props.labels.words[mode.value];
  return props.labels.label.replace('{mode}', stored.value ? word : props.labels.byDefault.replace('{mode}', word));
});

let media: MediaQueryList | undefined;
const root = () => document.documentElement;

function read() {
  try {
    const saved = localStorage.getItem('theme') as Mode | null;
    stored.value = saved && MODES.includes(saved) ? saved : null;
  } catch {
    stored.value = null;
  }
  const d = root().getAttribute('data-default-theme') as Mode | null;
  siteDefault.value = d && MODES.includes(d) ? d : 'system';
}

function apply() {
  osDark.value = !!media?.matches;
  root().classList.toggle('dark', mode.value === 'dark');
}

// Same as the journal's ModeToggle: every click flips what is on screen.
function cycle() {
  const next = mode.value === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* storage blocked: the change still applies to this page */
  }
  stored.value = next;
  apply();
  // The header renders a toggle per breakpoint; the other one re-reads.
  document.dispatchEvent(new Event('theme-change'));
}

onMounted(() => {
  media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', apply);
  document.addEventListener('theme-change', read);
  read();
  osDark.value = media.matches;
});

onUnmounted(() => {
  media?.removeEventListener('change', apply);
  document.removeEventListener('theme-change', read);
});
</script>
