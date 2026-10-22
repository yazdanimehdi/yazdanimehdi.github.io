<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, dismissToast, session, toasts, type Toast } from './api';
import { vDialog } from './dialog';
import type { AdminCtx } from './types';

/**
 * `narrow`: a reading-width list page (the dashboard, blog posts) instead of the form width. `dirty`: the open
 * document has unsaved changes. `badges`: a count beside a sidebar link, by its path.
 */
const props = defineProps<{
  ctx: AdminCtx;
  active: string;
  title: string;
  narrow?: boolean;
  dirty?: boolean;
  badges?: Record<string, number>;
}>();
const base = `/${props.ctx.adminPath}`;
session.mode = props.ctx.mode;
const banner = ref('');
// Phones (under 860px): the nav is a menu, closed until opened. Links reload the page, which closes it again.
const menuOpen = ref(false);
const menuBtn = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
// CV styles shares CV's place in the sidebar.
const current = computed(() => (props.active === 'cv-styles' ? 'cv' : props.active));
// What contributors edit most comes first, site-wide setup last; rarer content sits in a disclosure, open on its pages.
const GROUPS = computed(() => {
  const postgres = props.ctx.mode === 'postgres';
  return [
    {
      label: 'Content',
      links: [
        ['posts', 'Blog posts'],
        ['content/announcements', 'News'],
        ['publications', 'Publications'],
        ['cv', 'CV'],
        ['content/people', 'People'],
      ],
      more: [
        ['content/projects', 'Projects'],
        ['content/talks', 'Talks'],
        ['content/positions', 'Positions'],
      ],
    },
    ...(props.ctx.isOwner && postgres ? [{ label: 'Career', links: [['career', 'Job search']], more: [] }] : []),
    {
      label: 'Site',
      links: [
        ['pages', 'Pages'],
        ['media', 'Media'],
        ['editor', 'Site editor'],
      ],
      more: [],
    },
    {
      label: 'Setup',
      links: [['settings', 'Settings'], ['ai', 'Integrations'], ...(postgres ? [['users', 'Users']] : [])],
      more: [],
    },
  ];
});
const href = (path: string) => (path ? `${base}/${path}` : base);
const inMore = (links: string[][]) => links.some(([path]) => path === current.value);

/** Opening moves focus to the current page's link; closing (button or Escape) returns it to the button. */
async function setMenu(open: boolean) {
  menuOpen.value = open;
  await nextTick();
  if (open)
    (menu.value?.querySelector<HTMLElement>('[aria-current="page"]') ?? menu.value?.querySelector('a'))?.focus();
  else menuBtn.value?.focus();
}

// Jump to: every sidebar destination plus the create actions, filtered by a case-insensitive substring.
const DESTINATIONS = computed(() => [
  { path: '', label: 'Dashboard', group: '' },
  ...GROUPS.value.flatMap((g) => [...g.links, ...g.more].map(([path, label]) => ({ path, label, group: g.label }))),
  { path: 'posts/new', label: 'New blog post', group: 'Create' },
  { path: 'content/announcements?new', label: 'New news item', group: 'Create' },
  { path: 'publications?new', label: 'New publication', group: 'Create' },
]);
const jumpOpen = ref(false);
const query = ref('');
const picked = ref(0);
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  return DESTINATIONS.value.filter((d) => d.label.toLowerCase().includes(q));
});
const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const jump = ref<HTMLDialogElement | null>(null);
async function openJump() {
  query.value = '';
  picked.value = 0;
  jumpOpen.value = true;
  await nextTick(); // v-dialog has noted where focus was, to return it on close
  jump.value?.showModal();
}
function onJumpKey(e: KeyboardEvent) {
  const n = matches.value.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (n) picked.value = (picked.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    void nextTick(() => document.getElementById(`adm-jump-${picked.value}`)?.scrollIntoView({ block: 'nearest' }));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const d = matches.value[picked.value];
    if (d) go(d.path);
  }
}
const go = (path: string) => (location.href = href(path));
function onShortcut(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k' && !e.defaultPrevented) {
    e.preventDefault();
    if (!jumpOpen.value) openJump();
  }
}

// The header sticks to the top; once it does, a Rule shows under it and its height is offered to sticky content below.
const main = ref<HTMLElement | null>(null);
const head = ref<HTMLElement | null>(null);
const stuck = ref(false);
const onScroll = () => (stuck.value = !!head.value && head.value.getBoundingClientRect().top <= 0);
const heights = new ResizeObserver(() =>
  main.value?.style.setProperty('--adm-head-h', `${head.value?.offsetHeight ?? 0}px`),
);
function onLeave(e: BeforeUnloadEvent) {
  if (props.dirty) e.preventDefault();
}
onBeforeUnmount(() => {
  removeEventListener('scroll', onScroll);
  removeEventListener('keydown', onShortcut);
  removeEventListener('beforeunload', onLeave);
  heights.disconnect();
});
const regions = computed(() => [
  { key: 'polite', live: 'polite' as const, list: toasts.filter((t) => !t.error) },
  { key: 'assertive', live: 'assertive' as const, list: toasts.filter((t) => t.error) },
]);

function runAction(t: Toast) {
  t.action?.run();
  dismissToast(t.id);
}

onMounted(async () => {
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('keydown', onShortcut);
  addEventListener('beforeunload', onLeave);
  if (head.value) heights.observe(head.value);
  try {
    const { capabilities } = await api<{ capabilities: { error?: string } }>('me');
    banner.value = capabilities.error ?? '';
  } catch {
    // 401 reloads to the login page; other errors surface on the first save
  }
});

async function signOut() {
  await api('auth/logout', { method: 'POST' }).catch(() => undefined);
  location.href = `${base}/login`;
}
</script>

<template>
  <a class="adm-skip" href="#adm-main">Skip to content</a>
  <div class="adm-layout">
    <aside class="adm-side">
      <div class="adm-side-top">
        <div>
          <strong>{{ ctx.siteName }}</strong>
          <div class="adm-muted">Site admin</div>
        </div>
        <button
          ref="menuBtn"
          type="button"
          class="adm-btn adm-menu-btn"
          aria-controls="adm-menu"
          :aria-expanded="menuOpen"
          @click="setMenu(!menuOpen)"
        >
          Menu
        </button>
      </div>
      <div
        id="adm-menu"
        ref="menu"
        class="adm-menu"
        :class="{ 'is-open': menuOpen }"
        @keydown.esc="menuOpen && setMenu(false)"
      >
        <button type="button" class="adm-btn adm-jump-btn" aria-haspopup="dialog" @click="openJump">
          Jump to…
          <kbd aria-hidden="true">{{ mac ? '⌘K' : 'Ctrl K' }}</kbd>
        </button>
        <nav aria-label="Admin">
          <a :href="href('')" :aria-current="current === '' ? 'page' : undefined">Dashboard</a>
          <template v-for="group in GROUPS" :key="group.label">
            <div :id="`adm-nav-${group.label}`" class="adm-nav-label">{{ group.label }}</div>
            <ul :aria-labelledby="`adm-nav-${group.label}`">
              <li v-for="[path, label] in group.links" :key="path">
                <a :href="href(path)" :aria-current="current === path ? 'page' : undefined"
                  >{{ label
                  }}<span v-if="badges?.[path]" class="adm-badge"
                    >{{ badges[path] }}<span class="adm-visually-hidden"> waiting</span></span
                  ></a
                >
              </li>
            </ul>
            <details v-if="group.more.length" class="adm-nav-more" :open="inMore(group.more)">
              <summary>Projects, talks, positions</summary>
              <ul :aria-label="`More ${group.label.toLowerCase()}`">
                <li v-for="[path, label] in group.more" :key="path">
                  <a :href="href(path)" :aria-current="current === path ? 'page' : undefined">{{ label }}</a>
                </li>
              </ul>
            </details>
          </template>
        </nav>
        <div class="adm-side-foot">
          <a href="/" target="_blank" rel="noopener">View site <span aria-hidden="true">↗</span></a>
          <button type="button" class="adm-btn adm-btn-small" @click="signOut">Sign out</button>
        </div>
      </div>
    </aside>
    <main id="adm-main" ref="main" class="adm-main" :class="{ 'is-narrow': narrow }" tabindex="-1">
      <p v-if="banner || session.outage" class="adm-banner adm-banner-error" role="alert">
        {{ session.outage || banner }}
      </p>
      <div ref="head" class="adm-head" :class="{ 'is-stuck': stuck }">
        <h1>{{ title }}</h1>
        <div class="adm-actions">
          <span v-if="dirty" class="adm-muted">Unsaved changes</span>
          <slot name="actions" />
        </div>
      </div>
      <slot />
    </main>
    <dialog
      v-if="jumpOpen"
      ref="jump"
      v-dialog
      class="adm-jump"
      aria-label="Jump to"
      @close="jumpOpen = false"
      @click.self="jumpOpen = false"
    >
      <div>
        <input
          v-model="query"
          type="text"
          role="combobox"
          aria-label="Jump to"
          aria-expanded="true"
          aria-controls="adm-jump-list"
          aria-autocomplete="list"
          :aria-activedescendant="matches.length ? `adm-jump-${picked}` : undefined"
          placeholder="Jump to…"
          autocomplete="off"
          data-autofocus
          @input="picked = 0"
          @keydown="onJumpKey"
        />
        <ul id="adm-jump-list" role="listbox" aria-label="Destinations">
          <li
            v-for="(d, i) in matches"
            :id="`adm-jump-${i}`"
            :key="d.path"
            role="option"
            :aria-selected="i === picked"
            @click="go(d.path)"
            @mousemove="picked = i"
          >
            {{ d.label }}<span v-if="d.group" class="adm-muted"> {{ d.group }}</span>
          </li>
        </ul>
        <p v-if="!matches.length" class="adm-muted">Nothing matches.</p>
      </div>
    </dialog>
    <div class="adm-toasts">
      <div v-for="r in regions" :key="r.key" class="adm-toast-region" :aria-live="r.live" aria-atomic="false">
        <div v-for="t in r.list" :key="t.id" class="adm-toast" :class="{ 'adm-toast-error': t.error }">
          <span class="adm-toast-text">{{ t.text }}</span>
          <span class="adm-toast-actions">
            <a v-if="t.href" :href="t.href" target="_blank" rel="noopener">View commit</a>
            <button v-if="t.action" type="button" class="adm-btn adm-btn-small" @click="runAction(t)">
              {{ t.action.label }}
            </button>
            <button type="button" class="adm-toast-close" @click="dismissToast(t.id)">Dismiss</button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
