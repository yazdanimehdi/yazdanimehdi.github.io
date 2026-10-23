<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, report } from './api';
import { visible } from './career';
import { formatDate, relativeTime } from './dates';
import { vDialog } from './dialog';
import { AnswerText } from './RoomText';
import { KIND_NAMES, completeAt, linkQuery, matchTitles, outLinks } from './vault';
import type { AdminCtx } from './types';
import type { NoteRow, Suggestion, VaultNote } from '../lib/reading/types';

// Titles, generated text and suggestions (AI text) are shown with {{ }} or AnswerText only, never as HTML.
const props = defineProps<{ ctx: AdminCtx; id: string }>();
const base = `/${props.ctx.adminPath}`;
const id = Number(props.id);
const href = (n: number) => `${base}/reading/vault/${n}`;
const path = `reading/vault/notes/${id}`;

const note = ref<VaultNote | null>(null);
const generated = ref('');
const backlinks = ref<NoteRow[]>([]);
const suggestions = ref<Suggestion[]>([]);
const titles = ref<NoteRow[]>([]);
const loadError = ref('');
const body = ref('');
let savedBody = ''; // the body as last loaded or saved

async function loadTitles() {
  titles.value = (await api<{ notes: NoteRow[] }>('reading/vault/notes')).notes;
}

// Title: renamed on change, with the body, so its links to itself follow; a taken title is refused in place and the
// old one comes back.
const titleError = ref('');
const titleDraft = ref('');
async function rename() {
  const old = note.value!.title;
  const title = titleDraft.value.trim();
  titleError.value = '';
  if (!title || title === old) return void (titleDraft.value = old);
  await saving;
  clearTimeout(saveTimer);
  const text = body.value;
  try {
    const res = await api<{ note: VaultNote }>(path, { method: 'PATCH', body: { title, body: text } });
    note.value = res.note;
    savedBody = res.note.body;
    if (body.value === text) body.value = savedBody;
    titleDraft.value = res.note.title;
    titles.value = titles.value.map((t) => (t.id === id ? { ...t, title: res.note.title } : t));
  } catch (err) {
    titleError.value = (err as Error).message;
    titleDraft.value = old;
    void saveBody(); // the body that went with the refused rename
  }
}

// Your notes: saved on blur and a second after typing stops, one save at a time.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = Promise.resolve();
const saveStatus = ref('');
function saveBody() {
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    const text = body.value;
    if (text === savedBody) return;
    try {
      note.value = (await api<{ note: VaultNote }>(path, { method: 'PATCH', body: { body: text } })).note;
      savedBody = text;
      saveStatus.value = 'Saved';
      autoSuggest();
    } catch (e) {
      report(e);
    }
  });
  return saving;
}
/** Leaving the page: the last edit goes with a keepalive request, which outlives the page. */
function flushBody() {
  if (body.value === savedBody) return;
  clearTimeout(saveTimer);
  const text = body.value;
  void fetch(`/api/admin/${path}`, {
    method: 'PATCH',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: text }),
  }).then(
    (res) => res.ok && (savedBody = text),
    () => {}, // unsent: the next save sends it again
  );
}
const onHidden = () => document.visibilityState === 'hidden' && flushBody();

// [[ autocomplete: the textarea is a combobox over the titles matching the open link before the caret.
const textarea = ref<HTMLTextAreaElement | null>(null);
const link = ref<{ start: number; query: string } | null>(null);
const active = ref(0);
const options = computed(() => (link.value ? matchTitles(titles.value, link.value.query, id) : []));
function findLink() {
  const ta = textarea.value!;
  const was = link.value?.query;
  link.value = ta.selectionStart === ta.selectionEnd ? linkQuery(ta.value, ta.selectionStart) : null;
  if (link.value?.query !== was) active.value = 0;
}
function onInput() {
  saveStatus.value = '';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBody, 1000);
  findLink();
}
/** The i-th option, completed at the caret where it is now. */
async function pick(i: number) {
  const ta = textarea.value!;
  const done = completeAt(body.value, ta.selectionStart, titles.value, id, i);
  if (!done) return;
  body.value = done.text;
  link.value = null;
  await nextTick();
  ta.setSelectionRange(done.caret, done.caret);
  onInput();
}
function onKey(e: KeyboardEvent) {
  const n = options.value.length;
  if (!n) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    void nextTick(() => document.getElementById(`adm-vault-opt-${active.value}`)?.scrollIntoView({ block: 'nearest' }));
  } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
    findLink(); // the caret may have moved since the list opened
    if (!options.value.length) return; // no link there now: the key does its usual thing
    e.preventDefault();
    void pick(active.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    link.value = null;
  }
}
/** A caret moved by keyboard reads the link again (the same link keeps its active option). */
const CARET_KEYS = /^(Arrow(Left|Right|Up|Down)|Home|End|Page(Up|Down))$/;
function onKeyUp(e: KeyboardEvent) {
  if (CARET_KEYS.test(e.key)) findLink();
}
function onBlur() {
  link.value = null;
  void saveBody();
}

/** The body's links, each title once. */
const linksTo = computed(() => {
  const seen = new Set<string>();
  return outLinks(body.value, titles.value).filter(
    (l) => !seen.has(l.title.toLowerCase()) && seen.add(l.title.toLowerCase()),
  );
});

// Suggested links: made once automatically (silently), and again by the button (errors shown).
const suggesting = ref(false);
const suggestStatus = ref('');
const suggestError = ref('');
async function suggest(auto = false) {
  note.value!.suggestedAt = new Date().toISOString(); // the server stamps it too, on every attempt
  suggesting.value = true;
  suggestStatus.value = suggestError.value = '';
  try {
    suggestions.value = (
      await api<{ suggestions: Suggestion[] }>('reading/vault/suggest', { body: { note: id } })
    ).suggestions;
    if (!suggestions.value.length) suggestStatus.value = 'No links to suggest.';
  } catch (e) {
    if (!auto) suggestError.value = (e as Error).message;
  } finally {
    suggesting.value = false;
  }
}
function autoSuggest() {
  const n = note.value!;
  if (!n.suggestedAt && !suggesting.value && (n.kind !== 'free' || savedBody.trim())) void suggest(true);
}
const answering = ref(false);
async function answer(s: Suggestion, accept: boolean) {
  suggestError.value = '';
  if (accept) await saveBody();
  if (accept && body.value !== savedBody) {
    suggestError.value = 'Your latest writing isn’t saved yet, so nothing was linked. Try again once it is saved.';
    return;
  }
  answering.value = true;
  try {
    const res = await api<{ note: VaultNote }>(`reading/vault/suggestions/${s.id}`, {
      method: 'PATCH',
      body: { accept },
    });
    note.value = res.note;
    if (accept) {
      body.value = savedBody = res.note.body;
      await loadTitles(); // a new concept is a new note
    }
    suggestions.value = suggestions.value.filter((x) => x.id !== s.id);
  } catch (e) {
    report(e);
  } finally {
    answering.value = false;
  }
}

// Delete: a confirm, then back to the list.
const confirming = ref(false);
const deleting = ref(false);
const DELETE_MORE = {
  paper: ' Its highlights stay in the reading room.',
  chat: ' The answer stays in the paper’s chat, no longer saved.',
  free: '',
};
async function remove() {
  deleting.value = true;
  try {
    await api(path, { method: 'DELETE' });
    savedBody = body.value; // nothing left to flush
    location.href = `${base}/reading/vault`;
  } catch (e) {
    report(e);
    deleting.value = false;
  }
}

onMounted(async () => {
  addEventListener('pagehide', flushBody);
  document.addEventListener('visibilitychange', onHidden);
  try {
    const [res] = await Promise.all([
      api<{ note: VaultNote; generated: string; backlinks: NoteRow[]; suggestions: Suggestion[] }>(path),
      loadTitles(),
    ]);
    note.value = res.note;
    generated.value = res.generated;
    backlinks.value = res.backlinks;
    suggestions.value = res.suggestions;
    body.value = savedBody = res.note.body;
    titleDraft.value = res.note.title;
    autoSuggest();
  } catch (e) {
    loadError.value = (e as Error).message;
  }
});
onBeforeUnmount(() => {
  clearTimeout(saveTimer);
  removeEventListener('pagehide', flushBody);
  document.removeEventListener('visibilitychange', onHidden);
});

const NO_SET = new Set<never>();
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/vault" :title="note ? visible(note.title) : 'Note'">
    <p v-if="loadError" class="adm-err" role="alert">{{ loadError }}</p>
    <template v-else-if="note">
      <div class="adm-field adm-room-title adm-vault-act">
        <label for="adm-vault-note-title">Title</label>
        <input
          id="adm-vault-note-title"
          v-model="titleDraft"
          type="text"
          maxlength="200"
          :aria-invalid="!!titleError || undefined"
          :aria-describedby="titleError ? 'adm-vault-title-error' : undefined"
          @change="rename"
        />
        <span v-if="titleError" id="adm-vault-title-error" class="adm-err" role="alert">{{ titleError }}</span>
      </div>
      <p class="adm-muted">
        {{ KIND_NAMES[note.kind] }} · created {{ formatDate(note.createdAt) }} · updated
        {{ relativeTime(note.updatedAt) }}
      </p>
      <p v-if="note.kind === 'paper' && note.paperId">
        <a :href="`${base}/reading/papers/${note.paperId}`">Open in the reading room</a>
      </p>

      <template v-if="note.kind !== 'free'">
        <h2 class="adm-h2">From the reading room</h2>
        <AnswerText :body="generated" :known="NO_SET" :scans="NO_SET" />
      </template>

      <h2 id="adm-vault-body-label" class="adm-h2">Your notes</h2>
      <div class="adm-field">
        <div class="adm-vault-editor">
          <textarea
            ref="textarea"
            v-model="body"
            rows="12"
            maxlength="20000"
            role="combobox"
            aria-labelledby="adm-vault-body-label"
            aria-describedby="adm-vault-body-hint"
            aria-autocomplete="list"
            :aria-expanded="options.length > 0"
            aria-controls="adm-vault-options"
            :aria-activedescendant="options.length ? `adm-vault-opt-${active}` : undefined"
            :readonly="answering"
            @input="onInput"
            @click="findLink"
            @keydown="onKey"
            @keyup="onKeyUp"
            @blur="onBlur"
          />
          <ul
            v-show="options.length"
            id="adm-vault-options"
            role="listbox"
            aria-label="Notes"
            class="adm-vault-options"
          >
            <li
              v-for="(o, i) in options"
              :id="`adm-vault-opt-${i}`"
              :key="o.id"
              role="option"
              :aria-selected="i === active"
              @mousedown.prevent
              @click="pick(i)"
            >
              {{ visible(o.title) }}
            </li>
          </ul>
        </div>
        <small id="adm-vault-body-hint">Type [[ to link a note.</small>
      </div>
      <p class="adm-muted" role="status">{{ saveStatus }}</p>

      <template v-if="linksTo.length">
        <h2 class="adm-h2">Links to</h2>
        <ul class="adm-rows">
          <li v-for="l in linksTo" :key="l.title.toLowerCase()">
            <span class="adm-row-main">
              <a v-if="l.id !== null" :href="href(l.id)">{{ visible(l.title) }}</a>
              <span v-else>{{ visible(l.title) }} <span class="adm-muted">(no note yet)</span></span>
            </span>
          </li>
        </ul>
      </template>

      <h2 class="adm-h2">Backlinks</h2>
      <ul v-if="backlinks.length" class="adm-rows">
        <li v-for="b in backlinks" :key="b.id">
          <span class="adm-row-main">
            <a :href="href(b.id)">{{ visible(b.title) }}</a>
            <span class="adm-row-detail">{{ KIND_NAMES[b.kind] }} · updated {{ relativeTime(b.updatedAt) }}</span>
          </span>
        </li>
      </ul>
      <p v-else class="adm-muted">No notes link here yet.</p>

      <h2 class="adm-h2">Suggested links</h2>
      <ul v-if="suggestions.length" class="adm-rows">
        <li v-for="s in suggestions" :key="s.id">
          <span class="adm-row-main">
            <span>
              <a v-if="s.targetId !== null" :href="href(s.targetId)">{{ visible(s.title) }}</a>
              <template v-else>{{ visible(s.title) }} <span class="adm-muted">New note</span></template>
            </span>
            <span class="adm-row-detail">{{ visible(s.reason) }}</span>
          </span>
          <span class="adm-row-action adm-reading-actions">
            <button
              type="button"
              class="adm-btn"
              :disabled="answering"
              :aria-label="`Link “${visible(s.title)}”`"
              @click="answer(s, true)"
            >
              Link
            </button>
            <button
              type="button"
              class="adm-btn"
              :disabled="answering"
              :aria-label="`Dismiss “${visible(s.title)}”`"
              @click="answer(s, false)"
            >
              Dismiss
            </button>
          </span>
        </li>
      </ul>
      <p class="adm-vault-act">
        <button type="button" class="adm-btn" :disabled="suggesting" @click="suggest()">
          {{ suggesting ? 'Suggesting…' : 'Suggest links' }}
        </button>
      </p>
      <p class="adm-muted" role="status">{{ suggestStatus }}</p>
      <p v-if="suggestError" class="adm-err" role="alert">{{ suggestError }}</p>

      <p class="adm-vault-act adm-vault-delete">
        <button type="button" class="adm-btn adm-btn-danger" @click="confirming = true">Delete note</button>
      </p>

      <div
        v-if="confirming"
        v-dialog
        class="adm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adm-vault-delete"
        @keydown.esc="confirming = false"
      >
        <div>
          <h2 id="adm-vault-delete" class="adm-h2">Delete “{{ visible(note.title) }}”?</h2>
          <p>Links to it in other notes stay, unresolved.{{ DELETE_MORE[note.kind] }}</p>
          <div class="adm-actions">
            <button type="button" class="adm-btn" data-autofocus @click="confirming = false">Cancel</button>
            <button type="button" class="adm-btn adm-btn-danger" :disabled="deleting" @click="remove">
              Delete note
            </button>
          </div>
        </div>
      </div>
    </template>
  </AdminShell>
</template>
