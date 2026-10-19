<template>
  <div>
    <button
      ref="triggerRef"
      type="button"
      class="-m-1.5 inline-flex h-11 w-11 items-center justify-center rounded text-[var(--color-surface-500)] transition-colors hover:text-[var(--color-surface-700)] dark:text-dm-muted dark:hover:text-[#c9d1d9]"
      :aria-label="labels.open"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      aria-controls="mobile-nav"
      @click="open"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>

    <!-- A modal <dialog> sits in the top layer: the page behind it is inert, Escape closes it. -->
    <dialog
      id="mobile-nav"
      ref="dialogRef"
      class="mobile-nav start-0 end-auto m-0 h-full max-h-none w-64 max-w-[85vw] border-e border-[var(--color-surface-200)] bg-white p-0 shadow-lg backdrop:bg-black/40 dark:border-dm-border dark:bg-dm-alt"
      :aria-label="labels.dialog"
      @close="onClose"
      @click="onDialogClick"
    >
      <div class="flex h-full flex-col overflow-y-auto">
        <div
          class="flex items-center justify-between border-b border-[var(--color-surface-200)] py-2 ps-6 pe-4 dark:border-dm-border"
        >
          <span class="text-sm font-medium text-[var(--color-surface-700)] dark:text-dm-text">{{ labels.title }}</span>
          <button
            type="button"
            autofocus
            class="-m-2 inline-flex h-11 w-11 items-center justify-center rounded text-[var(--color-surface-400)] transition-colors hover:text-[var(--color-surface-600)] dark:text-dm-muted dark:hover:text-[#c9d1d9]"
            :aria-label="labels.close"
            @click="close"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav class="p-3" :aria-label="labels.primary">
          <ul>
            <li v-for="item in primary" :key="item.href">
              <a :href="item.href" :class="linkClass(item.href)" :aria-current="ariaCurrent(item.href)" @click="close">
                {{ item.label }}
              </a>
            </li>
          </ul>
          <template v-if="more.length > 0">
            <p
              id="mobile-nav-more"
              class="mt-3 border-t border-[var(--color-surface-200)] px-3 pt-3 pb-1 text-xs text-[var(--color-surface-500)] dark:border-dm-border dark:text-dm-muted"
            >
              {{ labels.more }}
            </p>
            <ul aria-labelledby="mobile-nav-more">
              <li v-for="item in more" :key="item.href">
                <a
                  :href="item.href"
                  :class="linkClass(item.href)"
                  :aria-current="ariaCurrent(item.href)"
                  @click="close"
                >
                  {{ item.label }}
                </a>
              </li>
            </ul>
          </template>
        </nav>
      </div>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

interface NavItem {
  label: string;
  href: string;
}

const props = defineProps<{
  /** The header's links in order, Contact last (`splitNav` primary + contact). */
  primary: NavItem[];
  /** The pages the header leaves out (`splitNav` more). */
  more: NavItem[];
  currentPath: string;
  /** Already translated. */
  labels: { open: string; title: string; close: string; dialog: string; primary: string; more: string };
}>();

const isOpen = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const dialogRef = ref<HTMLDialogElement | null>(null);

const isActive = (href: string) =>
  href === '/' ? props.currentPath === '/' : props.currentPath === href || props.currentPath.startsWith(`${href}/`);
const ariaCurrent = (href: string) => (isActive(href) ? 'page' : undefined);
const linkClass = (href: string) => [
  'flex min-h-11 items-center rounded px-3 text-sm transition-colors hover:bg-[var(--color-surface-50)] dark:hover:bg-[#21262d]',
  isActive(href)
    ? 'font-medium text-[var(--color-primary-600)] dark:text-[var(--color-accent-400)]'
    : 'text-[var(--color-surface-600)] hover:text-[var(--color-primary-600)] dark:text-dm-muted dark:hover:text-[var(--color-accent-400)]',
];

function open() {
  dialogRef.value?.showModal();
  isOpen.value = true;
}

function close() {
  dialogRef.value?.close();
}

// Runs for every close: the close button, a link, Escape and a backdrop click.
function onClose() {
  isOpen.value = false;
  triggerRef.value?.focus();
}

// The trigger's wrapper is md:hidden, so a viewport widening past md would leave the modal open, invisible, and the page inert.
let desktop: MediaQueryList | undefined;
function closeOnDesktop(e: MediaQueryListEvent) {
  if (e.matches) close();
}
onMounted(() => {
  desktop = window.matchMedia('(min-width: 768px)');
  desktop.addEventListener('change', closeOnDesktop);
});
onUnmounted(() => desktop?.removeEventListener('change', closeOnDesktop));

// The panel's content fills the dialog, so a click whose target is the dialog itself landed on the backdrop.
function onDialogClick(e: MouseEvent) {
  if (e.target === dialogRef.value) close();
}
</script>

<style scoped>
.mobile-nav[open] {
  animation: drawer-in 0.25s ease-out;
}
.mobile-nav[open]:dir(rtl) {
  animation-name: drawer-in-rtl;
}
.mobile-nav[open]::backdrop {
  animation: backdrop-in 0.2s ease;
}
@keyframes drawer-in {
  from {
    transform: translateX(-100%);
  }
}
@keyframes drawer-in-rtl {
  from {
    transform: translateX(100%);
  }
}
@keyframes backdrop-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mobile-nav[open],
  .mobile-nav[open]::backdrop {
    animation: none;
  }
}
</style>
