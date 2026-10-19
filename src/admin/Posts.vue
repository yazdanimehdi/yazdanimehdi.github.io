<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, committed, report, toast } from './api';
import { formatDate } from './dates';
import { STATUS_CHIP } from './status';
import type { AdminCtx, CommitResult, Entry } from './types';
import type { FeedItem } from '../lib/types';
import { postStatus, safeHref } from '../lib/utils';

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const posts = ref<Entry[]>([]);
const loading = ref(true);
const source = ref<'site' | 'imported'>(
  new URLSearchParams(location.search).get('source') === 'imported' ? 'imported' : 'site',
);
const imported = ref<{ items: FeedItem[]; hidden: string[]; error?: string } | null>(null);
const hidden = computed(() => new Set(imported.value?.hidden ?? []));

async function loadImported() {
  try {
    imported.value = await api<{ items: FeedItem[]; hidden: string[]; error?: string }>('feeds/hidden');
  } catch (e) {
    report(e);
  }
}

function show(next: 'site' | 'imported') {
  source.value = next;
  history.replaceState(null, '', next === 'imported' ? '?source=imported' : location.pathname);
}

/** Hiding is undoable from its toast instead of confirmed up front: it is one click to reverse, and nothing is lost. */
async function setHidden(item: FeedItem, hide: boolean) {
  try {
    const result = await api<CommitResult>('feeds/hidden', { method: 'PUT', body: { id: item.id, hidden: hide } });
    const ids = new Set(hidden.value);
    if (hide) ids.add(item.id);
    else ids.delete(item.id);
    imported.value = { ...imported.value!, hidden: [...ids] };
    if (hide)
      toast(`Hid “${item.title}” from the site`, result.url, { label: 'Undo', run: () => void setHidden(item, false) });
    else committed(result);
  } catch (e) {
    report(e);
  }
}

onMounted(async () => {
  void loadImported();
  try {
    posts.value = (await api<Entry[]>('collections/posts')).sort((a, b) =>
      String(b.data.date).localeCompare(String(a.data.date)),
    );
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="posts" title="Blog posts" narrow>
    <template #actions>
      <a class="adm-btn adm-btn-primary" :href="`${base}/posts/new`">New blog post</a>
    </template>
    <div class="adm-filter" role="group" aria-label="Source">
      <button type="button" :aria-pressed="source === 'site'" @click="show('site')">
        Written here <span class="adm-count">{{ posts.length }}</span>
      </button>
      <button type="button" :aria-pressed="source === 'imported'" @click="show('imported')">
        Imported from feeds <span class="adm-count">{{ imported?.items.length ?? '' }}</span>
      </button>
    </div>

    <template v-if="source === 'site'">
      <p v-if="loading" class="adm-muted" role="status">Loading…</p>
      <ul v-else-if="posts.length" class="adm-rows">
        <li v-for="p in posts" :key="p.slug">
          <a class="adm-row-title" dir="auto" :href="`${base}/posts/${p.slug}`">{{ p.data.title || p.slug }}</a>
          <span class="adm-status" :class="STATUS_CHIP[postStatus(p.data).replace(/ · .*/, '')]">{{
            postStatus(p.data).replace(/ · .*/, '')
          }}</span>
          <time v-if="p.data.date" class="adm-row-date" :datetime="String(p.data.date).slice(0, 10)">{{
            formatDate(String(p.data.date).slice(0, 10))
          }}</time>
        </li>
      </ul>
      <p v-else class="adm-muted">No posts yet. <a :href="`${base}/posts/new`">Start a blog post</a>.</p>
    </template>

    <template v-else>
      <p v-if="!imported" class="adm-muted" role="status">Loading…</p>
      <p v-else-if="imported.error" class="adm-banner adm-banner-error" role="alert">{{ imported.error }}</p>
      <template v-else>
        <p class="adm-muted">
          Posts pulled in from your feeds. Hide one to keep it off the site; the feed itself is unchanged.
        </p>
        <ul v-if="imported.items.length" class="adm-rows">
          <li v-for="f in imported.items" :key="f.id">
            <span class="adm-row-title">
              <a dir="auto" :href="safeHref(f.link)" target="_blank" rel="noopener">{{ f.title }}</a>
              <span class="adm-row-detail">{{ f.source }}</span>
            </span>
            <span class="adm-status" :class="{ 'adm-status-hidden': hidden.has(f.id) }">{{
              hidden.has(f.id) ? 'Hidden' : 'Published'
            }}</span>
            <time class="adm-row-date" :datetime="f.date">{{ formatDate(f.date) }}</time>
            <button
              type="button"
              class="adm-btn adm-btn-small"
              :aria-label="`${hidden.has(f.id) ? 'Unhide' : 'Hide'} ‘${f.title}’`"
              @click="setHidden(f, !hidden.has(f.id))"
            >
              {{ hidden.has(f.id) ? 'Unhide' : 'Hide' }}
            </button>
          </li>
        </ul>
        <p v-else class="adm-muted">
          Nothing imported yet. Add a feed in <a :href="`${base}/settings#feeds`">Settings</a>, then sync it from the
          <a :href="base">Dashboard</a>.
        </p>
      </template>
    </template>
  </AdminShell>
</template>
