<template>
  <div>
    <!-- Trigger button -->
    <button
      type="button"
      class="relative hidden items-center gap-2 rounded border border-surface-200 bg-surface-50 px-3 py-1.5 text-sm text-surface-700 transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 hover:border-surface-300 sm:inline-flex dark:border-dm-border-alt dark:bg-dm-alt dark:text-dm-muted dark:hover:border-[#8b949e]"
      :aria-label="labels.search"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      aria-controls="search-dialog"
      @click="open"
    >
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <span>{{ labels.search }}</span>
      <kbd
        v-if="shortcut"
        dir="ltr"
        class="hidden items-center gap-0.5 rounded bg-surface-200 px-1.5 py-0.5 font-mono text-xs text-surface-600 sm:inline-flex dark:bg-dm-border dark:text-dm-text"
        >{{ shortcut }}</kbd
      >
    </button>

    <!-- A modal <dialog> in the top layer: the page behind is inert, Escape closes it, and focus returns on close.
         Teleported to <body>: the trigger sits in the header's md-only row, and a display:none ancestor would
         leave the open modal invisible on phones while the page stays inert. -->
    <Teleport to="body">
      <dialog
        id="search-dialog"
        ref="dialogRef"
        class="search-dialog mx-auto mt-[15vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded border border-surface-200 bg-white p-0 text-surface-900 backdrop:bg-black/50 dark:border-dm-border-alt dark:bg-dm-alt dark:text-dm-heading"
        :aria-label="labels.search"
        @close="onClose"
        @click="onDialogClick"
      >
        <div>
          <div
            class="flex items-center gap-3 border-b border-surface-200 px-4 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary-500 dark:border-dm-border dark:focus-within:outline-accent-500"
          >
            <svg
              class="h-5 w-5 shrink-0 text-surface-500 dark:text-dm-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <!-- The row above draws the focus ring, around the icon and the field together. -->
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              autofocus
              :placeholder="labels.placeholder"
              :aria-label="labels.search"
              class="min-h-11 flex-1 bg-transparent py-3 text-sm text-surface-900 placeholder-surface-500 focus:outline-none dark:text-dm-heading dark:placeholder-dm-muted"
            />
            <button
              type="button"
              class="-me-2 inline-flex min-h-11 items-center px-2"
              :aria-label="labels.close"
              @click="close"
            >
              <kbd
                class="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-xs text-surface-600 dark:bg-dm-border dark:text-dm-text"
                >Esc</kbd
              >
            </button>
          </div>

          <div class="max-h-80 overflow-y-auto p-2">
            <p v-if="!query" class="py-8 text-center text-sm text-surface-500 dark:text-dm-muted">
              {{ labels.prompt }}
            </p>
            <div v-else-if="results.length === 0" class="px-3 py-6 text-center text-sm">
              <p class="text-surface-600 dark:text-dm-text">{{ labels.empty.replace('{query}', query) }}</p>
              <template v-if="pages.length > 0">
                <p class="mt-3 text-xs text-surface-500 dark:text-dm-muted">{{ labels.browse }}</p>
                <ul class="mt-1 flex flex-wrap justify-center gap-x-4">
                  <li v-for="page in pages" :key="page.href">
                    <a
                      :href="page.href"
                      class="inline-flex min-h-11 items-center text-primary-600 underline-offset-4 hover:underline dark:text-accent-400"
                      >{{ page.label }}</a
                    >
                  </li>
                </ul>
              </template>
            </div>
            <ul v-else>
              <li v-for="result in results" :key="result.href">
                <a
                  :href="result.href"
                  class="flex items-center gap-3 rounded px-3 py-2.5 text-sm transition-colors hover:bg-surface-50 dark:hover:bg-dm-hover"
                >
                  <span
                    aria-hidden="true"
                    class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary-50 text-xs font-medium text-primary-600 dark:bg-dm-border dark:text-accent-400"
                  >
                    {{ result.type.charAt(0).toUpperCase() }}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span dir="auto" class="block truncate font-medium text-surface-900 dark:text-dm-heading">{{
                      result.title
                    }}</span>
                    <span class="block text-xs text-surface-500 capitalize dark:text-dm-muted">{{ result.type }}</span>
                  </span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </dialog>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface SearchItem {
  title: string;
  href: string;
  type: string;
  content?: string;
}

const props = defineProps<{
  items: SearchItem[];
  /** Pages offered when nothing matches (the header's links). */
  pages: { label: string; href: string }[];
  /** Translated text; `empty` contains `{query}`. */
  labels: { search: string; placeholder: string; prompt: string; empty: string; browse: string; close: string };
}>();

// The hint names the platform's modifier; it stays empty until mounted so the server never guesses.
const shortcut = ref('');

const isOpen = ref(false);
const query = ref('');
const dialogRef = ref<HTMLDialogElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
// Whatever had focus when the dialog opened: the desktop button, the mobile header button, or the page for ⌘K.
let returnFocus: HTMLElement | null = null;

const results = computed(() => {
  if (!query.value) return [];
  const q = query.value.toLowerCase();
  return props.items
    .filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        (item.content && item.content.toLowerCase().includes(q)),
    )
    .slice(0, 10);
});

function open() {
  if (!dialogRef.value || dialogRef.value.open) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  query.value = '';
  dialogRef.value.showModal();
  isOpen.value = true;
  inputRef.value?.focus();
}

function close() {
  dialogRef.value?.close();
}

// Runs for every close: Escape, the Esc button, a backdrop click and ⌘K.
function onClose() {
  isOpen.value = false;
  returnFocus?.focus();
}

// The panel fills the dialog, so a click whose target is the dialog itself landed on the backdrop.
function onDialogClick(e: MouseEvent) {
  if (e.target === dialogRef.value) close();
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (isOpen.value) close();
    else open();
  }
}

onMounted(() => {
  shortcut.value = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('open-search', open);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('open-search', open);
});
</script>

<style scoped>
.search-dialog[open],
.search-dialog[open]::backdrop {
  animation: fade-in 0.15s ease-out;
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .search-dialog[open],
  .search-dialog[open]::backdrop {
    animation: none;
  }
}
</style>
