<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import { api, report, toast } from './api';
import { visible } from './career';
import { relativeTime } from './dates';
import { vDialog } from './dialog';
import type { AdminCtx } from './types';

interface Notebook {
  id: number;
  title: string;
  papers: number;
  updatedAt: string;
}

// Titles are the owner's, but may come from a paper's title: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const open = (id: number) => `${base}/reading/notebooks/${id}`;

const notebooks = ref<Notebook[] | null>(null);
const title = ref('');
const creating = ref(false);
const createError = ref('');
const confirming = ref<Notebook | null>(null);
const deleting = ref(false);

const line = (n: Notebook) => `${n.papers} paper${n.papers === 1 ? '' : 's'} · updated ${relativeTime(n.updatedAt)}`;

async function create() {
  creating.value = true;
  try {
    const { id } = await api<{ id: number }>('reading/notebooks', { body: { title: title.value.trim() } });
    location.href = open(id);
  } catch (e) {
    createError.value = (e as Error).message;
    creating.value = false;
  }
}

async function remove() {
  const n = confirming.value!;
  deleting.value = true;
  try {
    await api(`reading/notebooks/${n.id}`, { method: 'DELETE' });
    notebooks.value = notebooks.value!.filter((x) => x.id !== n.id);
    confirming.value = null;
    // The row's Delete, where the dialog would return focus, is gone.
    void nextTick(() => document.getElementById('adm-main')?.focus());
    toast('Notebook deleted');
  } catch (e) {
    report(e);
  } finally {
    deleting.value = false;
  }
}

onMounted(async () => {
  try {
    notebooks.value = (await api<{ notebooks: Notebook[] }>('reading/notebooks')).notebooks;
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/notebooks" title="Notebooks">
    <AdminTabLinks
      label="Reading"
      :tabs="[
        { href: `${base}/reading`, label: 'Today' },
        { href: `${base}/reading/library`, label: 'Library' },
        { href: `${base}/reading/notebooks`, label: 'Notebooks', current: true },
        { href: `${base}/reading/settings`, label: 'Settings' },
      ]"
    />
    <h2 class="adm-h2">New notebook</h2>
    <form class="adm-field" @submit.prevent="create">
      <label for="adm-notebook-title">Title</label>
      <div class="adm-list-row">
        <input
          id="adm-notebook-title"
          v-model="title"
          type="text"
          maxlength="200"
          :aria-invalid="!!createError || undefined"
          :aria-describedby="createError ? 'adm-notebook-error' : undefined"
          @input="createError = ''"
        />
        <button type="submit" class="adm-btn adm-btn-primary" :disabled="creating || !title.trim()">
          {{ creating ? 'Creating…' : 'Create' }}
        </button>
      </div>
      <span v-if="createError" id="adm-notebook-error" class="adm-err" role="alert">{{ createError }}</span>
    </form>

    <h2 class="adm-h2">Your notebooks</h2>
    <p v-if="!notebooks" class="adm-muted">Loading…</p>
    <p v-else-if="!notebooks.length" class="adm-muted">
      No notebooks yet. A notebook groups papers so the summary, study aids and chat work across them.
    </p>
    <ul v-else class="adm-rows">
      <li v-for="n in notebooks" :key="n.id">
        <span class="adm-row-main">
          <a :href="open(n.id)">{{ visible(n.title) }}</a>
          <span class="adm-row-detail">{{ line(n) }}</span>
        </span>
        <span class="adm-row-action adm-reading-actions">
          <button
            type="button"
            class="adm-btn adm-btn-danger"
            :aria-label="`Delete ${visible(n.title)}`"
            @click="confirming = n"
          >
            Delete
          </button>
        </span>
      </li>
    </ul>

    <div
      v-if="confirming"
      v-dialog
      class="adm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-notebook-delete"
      @keydown.esc="confirming = null"
    >
      <div>
        <h2 id="adm-notebook-delete" class="adm-h2">Delete “{{ visible(confirming.title) }}”?</h2>
        <p>Its summary, study aids, chat and note are deleted with it. The papers themselves are kept.</p>
        <div class="adm-actions">
          <button type="button" class="adm-btn" data-autofocus @click="confirming = null">Cancel</button>
          <button type="button" class="adm-btn adm-btn-danger" :disabled="deleting" @click="remove">
            Delete notebook
          </button>
        </div>
      </div>
    </div>
  </AdminShell>
</template>
