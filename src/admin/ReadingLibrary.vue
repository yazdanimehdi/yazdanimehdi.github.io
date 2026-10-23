<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import ReadingDraftButton from './ReadingDraftButton.vue';
import { api, report, toast } from './api';
import { visible } from './career';
import { formatDate } from './dates';
import { SOURCE_NAMES, authorsLine } from './reading';
import type { AdminCtx } from './types';
import { DRAFT_MAX_PAPERS } from '../lib/reading/limits';
import type { LibraryItem } from '../lib/reading/types';

// Titles and authors are third-party text: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const room = (id: number) => `${base}/reading/papers/${id}`;

const papers = ref<LibraryItem[] | null>(null);
const paperRef = ref('');
const adding = ref(false);
const addError = ref('');

// Papers ticked for a draft, in the order ticked: 1 to DRAFT_MAX_PAPERS make a post.
const selected = ref<number[]>([]);
const draftFrom = computed(() =>
  selected.value.length && selected.value.length <= DRAFT_MAX_PAPERS ? { papers: [...selected.value] } : null,
);
const draftHint = computed(() =>
  selected.value.length > DRAFT_MAX_PAPERS
    ? `A post can draw on up to ${DRAFT_MAX_PAPERS} papers.`
    : 'Writes an unpublished draft in your voice from the selected papers (a roundup when there are several) and your notes, and opens it in the blog editor. One reading-room AI call.',
);

const meta = ({ paper, savedAt }: LibraryItem) =>
  [authorsLine(paper.authors), SOURCE_NAMES[paper.source] ?? paper.source, `saved ${formatDate(savedAt)}`]
    .filter(Boolean)
    .join(' · ');

/** Saves the paper by arXiv id or DOI and opens its room. */
async function add() {
  adding.value = true;
  try {
    const { id } = await api<{ id: number }>('reading/papers', { body: { ref: paperRef.value.trim() } });
    location.href = room(id);
  } catch (e) {
    addError.value = (e as Error).message;
    adding.value = false;
  }
}

function focusSave(id: number | null) {
  void nextTick(() => {
    const row = id === null ? null : document.querySelector(`[data-row="${id}"]`);
    (row?.querySelector<HTMLElement>('button') ?? document.getElementById('adm-main'))?.focus();
  });
}

/** Unsaving removes the row, and focus moves to the next row's button; Undo saves it again in its place. */
async function unsave(item: LibraryItem) {
  const list = papers.value!;
  try {
    await api(`reading/papers/${item.paper.id}`, { method: 'PATCH', body: { state: 'new' } });
  } catch (e) {
    return report(e);
  }
  const at = list.indexOf(item); // after the await: a double click's first unsave may have removed it already
  if (at < 0) return;
  list.splice(at, 1);
  selected.value = selected.value.filter((id) => id !== item.paper.id);
  focusSave((list[at] ?? list[at - 1])?.paper.id ?? null);
  toast('Removed from the library', undefined, {
    label: 'Undo',
    run: async () => {
      try {
        await api(`reading/papers/${item.paper.id}`, { method: 'PATCH', body: { state: 'saved' } });
      } catch (e) {
        return report(e);
      }
      list.splice(Math.min(at, list.length), 0, item);
      focusSave(item.paper.id);
    },
  });
}

onMounted(async () => {
  try {
    papers.value = (await api<{ papers: LibraryItem[] }>('reading/papers')).papers;
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/library" title="Library">
    <AdminTabLinks
      label="Reading"
      :tabs="[
        { href: `${base}/reading`, label: 'Today' },
        { href: `${base}/reading/library`, label: 'Library', current: true },
        { href: `${base}/reading/notebooks`, label: 'Notebooks' },
        { href: `${base}/reading/vault`, label: 'Vault' },
        { href: `${base}/reading/settings`, label: 'Settings' },
      ]"
    />
    <h2 class="adm-h2">Add a paper</h2>
    <form class="adm-field" @submit.prevent="add">
      <label for="adm-library-ref">arXiv id or DOI</label>
      <div class="adm-list-row">
        <input
          id="adm-library-ref"
          v-model="paperRef"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="!!addError || undefined"
          :aria-describedby="addError ? 'adm-library-error' : undefined"
          @input="addError = ''"
        />
        <button type="submit" class="adm-btn adm-btn-primary" :disabled="adding || !paperRef.trim()">
          {{ adding ? 'Adding…' : 'Add' }}
        </button>
      </div>
      <span v-if="addError" id="adm-library-error" class="adm-err" role="alert">{{ addError }}</span>
    </form>

    <h2 class="adm-h2">Saved papers</h2>
    <p v-if="!papers" class="adm-muted">Loading…</p>
    <p v-else-if="!papers.length" class="adm-muted">
      No saved papers yet. Save one from Today, or add one by its arXiv id or DOI.
    </p>
    <template v-else>
      <div class="adm-actions">
        <span class="adm-muted" role="status">{{ selected.length }} selected</span>
        <ReadingDraftButton :ctx="ctx" :from="draftFrom" :hint="draftHint" />
      </div>
      <ul class="adm-rows">
        <li v-for="item in papers" :key="item.paper.id" :data-row="item.paper.id">
          <span class="adm-row-main">
            <a :href="room(item.paper.id)">{{ visible(item.paper.title) }}</a>
            <span class="adm-row-detail">{{ meta(item) }}</span>
          </span>
          <span class="adm-row-action adm-reading-actions">
            <label class="adm-check adm-draft-pick">
              <input
                v-model="selected"
                type="checkbox"
                :value="item.paper.id"
                :aria-label="`Select “${visible(item.paper.title)}”`"
              />
            </label>
            <button type="button" class="adm-btn" aria-pressed="true" @click="unsave(item)">Saved</button>
          </span>
        </li>
      </ul>
    </template>
  </AdminShell>
</template>
