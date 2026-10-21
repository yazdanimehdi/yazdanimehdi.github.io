<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { api, dismissToast, session, toasts, type Toast } from './api';
import type { AdminCtx } from './types';

/** `narrow`: a reading-width list page (the dashboard, blog posts) instead of the form width. */
const props = defineProps<{ ctx: AdminCtx; active: string; title: string; narrow?: boolean }>();
const base = `/${props.ctx.adminPath}`;
session.mode = props.ctx.mode;
const banner = ref('');
// Phones (under 860px): the nav is a menu, closed until opened. Links reload the page, which closes it again.
const menuOpen = ref(false);
const menuBtn = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
// What contributors edit most comes first, site-wide setup last; rarer content sits in a disclosure, open on its pages.
const GROUPS = computed(() => [
  {
    label: 'Content',
    links: [
      ['posts', 'Blog posts'],
      ['content/announcements', 'News'],
      ['content/people', 'People'],
      ['publications', 'Publications'],
      ['cv', 'CV'],
      ...(props.ctx.mode === 'static' ? [] : [['cv-styles', 'CV styles']]),
    ],
    more: [
      ['content/projects', 'Projects'],
      ['content/talks', 'Talks'],
      ['content/positions', 'Positions'],
    ],
  },
  {
    label: 'Site',
    links: [
      ['pages', 'Pages'],
      ['media', 'Media'],
      ['ai', 'Scholar & AI'],
      ['editor', 'Site editor'],
      ...(props.ctx.mode === 'postgres' ? [['users', 'Users']] : []),
      ['settings', 'Settings'],
    ],
    more: [] as string[][],
  },
]);
const href = (path: string) => (path ? `${base}/${path}` : base);
const inMore = (links: string[][]) => links.some(([path]) => path === props.active);

/** Opening moves focus to the current page's link; closing (button or Escape) returns it to the button. */
async function setMenu(open: boolean) {
  menuOpen.value = open;
  await nextTick();
  if (open)
    (menu.value?.querySelector<HTMLElement>('[aria-current="page"]') ?? menu.value?.querySelector('a'))?.focus();
  else menuBtn.value?.focus();
}
const regions = computed(() => [
  { key: 'polite', live: 'polite' as const, list: toasts.filter((t) => !t.error) },
  { key: 'assertive', live: 'assertive' as const, list: toasts.filter((t) => t.error) },
]);

function runAction(t: Toast) {
  t.action?.run();
  dismissToast(t.id);
}

onMounted(async () => {
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
        <nav aria-label="Admin">
          <a :href="href('')" :aria-current="active === '' ? 'page' : undefined">Dashboard</a>
          <template v-for="group in GROUPS" :key="group.label">
            <div :id="`adm-nav-${group.label}`" class="adm-nav-label">{{ group.label }}</div>
            <ul :aria-labelledby="`adm-nav-${group.label}`">
              <li v-for="[path, label] in group.links" :key="path">
                <a :href="href(path)" :aria-current="active === path ? 'page' : undefined">{{ label }}</a>
              </li>
            </ul>
            <details v-if="group.more.length" class="adm-nav-more" :open="inMore(group.more)">
              <summary>Projects, talks, positions</summary>
              <ul :aria-label="`More ${group.label.toLowerCase()}`">
                <li v-for="[path, label] in group.more" :key="path">
                  <a :href="href(path)" :aria-current="active === path ? 'page' : undefined">{{ label }}</a>
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
    <main id="adm-main" class="adm-main" :class="{ 'is-narrow': narrow }" tabindex="-1">
      <p v-if="banner || session.outage" class="adm-banner adm-banner-error" role="alert">
        {{ session.outage || banner }}
      </p>
      <div class="adm-head">
        <h1>{{ title }}</h1>
        <div class="adm-actions"><slot name="actions" /></div>
      </div>
      <slot />
    </main>
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
