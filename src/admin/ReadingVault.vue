<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import { api, report } from './api';
import { visible } from './career';
import { relativeTime } from './dates';
import { KIND_NAMES } from './vault';
import type { AdminCtx } from './types';
import type { NoteKind, NoteRow } from '../lib/reading/types';

// Titles may come from a paper's title: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const open = (id: number) => `${base}/reading/vault/${id}`;

const notes = ref<NoteRow[] | null>(null);
const q = ref('');
const kind = ref<NoteKind | ''>('');
/** the filters the shown list answers */
const shown = ref({ q: '', kind: '' as NoteKind | '' });

async function load() {
  const want = { q: q.value.trim(), kind: kind.value };
  const query = new URLSearchParams(Object.entries(want).filter(([, v]) => v));
  try {
    const res = await api<{ notes: NoteRow[] }>(`reading/vault/notes?${query}`);
    if (want.q !== q.value.trim() || want.kind !== kind.value) return; // a later search's answer wins
    notes.value = res.notes;
    shown.value = want;
  } catch (e) {
    report(e);
  }
}
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
});
watch(kind, load);

const PLURAL = { paper: 'papers', chat: 'chats', free: 'notes' } as const;

const title = ref('');
const creating = ref(false);
const createError = ref('');
async function create() {
  creating.value = true;
  try {
    const { id } = await api<{ id: number }>('reading/vault/notes', { body: { title: title.value.trim() } });
    location.href = open(id);
  } catch (e) {
    createError.value = (e as Error).message;
    creating.value = false;
  }
}

const exporting = ref(false);
const exportError = ref('');
/** The zip as a download; the server's sentence (too big, unreachable) in place. */
async function exportZip() {
  exporting.value = true;
  exportError.value = '';
  try {
    const res = await fetch('/api/admin/reading/vault/export');
    if (!res.ok) {
      const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
      throw new Error(data?.error ?? res.statusText);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'vault.zip';
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    exportError.value = (e as Error).message;
  } finally {
    exporting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/vault" title="Vault">
    <AdminTabLinks
      label="Reading"
      :tabs="[
        { href: `${base}/reading`, label: 'Today' },
        { href: `${base}/reading/library`, label: 'Library' },
        { href: `${base}/reading/notebooks`, label: 'Notebooks' },
        { href: `${base}/reading/vault`, label: 'Vault', current: true },
        { href: `${base}/reading/settings`, label: 'Settings' },
      ]"
    />
    <p>Linked Markdown notes on what you read, in Obsidian’s format.</p>

    <div class="adm-vault-filters">
      <label class="adm-field">
        <span>Search notes</span>
        <input v-model="q" type="search" maxlength="200" autocomplete="off" />
      </label>
      <label class="adm-field">
        <span>Kind</span>
        <select v-model="kind">
          <option value="">All notes</option>
          <option value="paper">Papers</option>
          <option value="chat">Chats</option>
          <option value="free">Notes</option>
        </select>
      </label>
      <a class="adm-btn" :href="`${base}/reading/vault/graph`">Graph</a>
    </div>

    <p v-if="!notes" class="adm-muted">Loading…</p>
    <p v-else-if="!notes.length && shown.q" class="adm-muted">No notes match “{{ shown.q }}”.</p>
    <p v-else-if="!notes.length && shown.kind" class="adm-muted">No {{ PLURAL[shown.kind] }} yet.</p>
    <p v-else-if="!notes.length" class="adm-muted">
      No notes yet. Saving a paper, highlighting it or writing a note on it adds its note here, and so does saving a
      chat answer. Or start a note of your own.
    </p>
    <ul v-else class="adm-rows">
      <li v-for="n in notes" :key="n.id">
        <span class="adm-row-main">
          <a :href="open(n.id)">{{ visible(n.title) }}</a>
          <span class="adm-row-detail">{{ KIND_NAMES[n.kind] }} · updated {{ relativeTime(n.updatedAt) }}</span>
        </span>
      </li>
    </ul>

    <h2 class="adm-h2">New note</h2>
    <form class="adm-field adm-vault-act" @submit.prevent="create">
      <label for="adm-vault-title">Title</label>
      <div class="adm-list-row">
        <input
          id="adm-vault-title"
          v-model="title"
          type="text"
          maxlength="200"
          :aria-invalid="!!createError || undefined"
          :aria-describedby="createError ? 'adm-vault-error' : undefined"
          @input="createError = ''"
        />
        <button type="submit" class="adm-btn adm-btn-primary" :disabled="creating || !title.trim()">
          {{ creating ? 'Creating…' : 'Create' }}
        </button>
      </div>
      <span v-if="createError" id="adm-vault-error" class="adm-err" role="alert">{{ createError }}</span>
    </form>

    <h2 class="adm-h2">Export</h2>
    <div class="adm-field adm-vault-act adm-vault-export">
      <button
        type="button"
        class="adm-btn"
        :disabled="exporting"
        aria-describedby="adm-vault-export-hint"
        @click="exportZip"
      >
        {{ exporting ? 'Exporting…' : 'Export as a zip' }}
      </button>
      <small id="adm-vault-export-hint">
        One Markdown file per note in papers/, notes/ and chats/, which Obsidian opens as a vault. It holds your notes,
        highlights and summaries, never a paper’s full text.
      </small>
      <span v-if="exportError" class="adm-err" role="alert">{{ exportError }}</span>
    </div>
  </AdminShell>
</template>
