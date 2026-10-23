<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AdminShell from './AdminShell.vue';
import ReadingDraftButton from './ReadingDraftButton.vue';
import ReadingVisibility from './ReadingVisibility.vue';
import { ApiError, api, report, toast } from './api';
import { visible } from './career';
import { formatDate } from './dates';
import { SOURCE_NAMES, authorsLine } from './reading';
import { progressLine, selectionInPassage, textLabel } from './reading-room';
import { AnswerText, ClaimList, PaperText } from './RoomText';
import type { AdminCtx } from './types';
import type { ChatMessage, Cite, Highlight, Output, OutputKind, Paper, Passage, TextState } from '../lib/reading/types';
import type { Visibility } from '../lib/reading/visibility';

// Paper text, titles and AI output are third-party: shown with {{ }} or through RoomText's text-node renderers only.
const props = defineProps<{ ctx: AdminCtx; paper?: string; notebook?: string }>();
const base = `/${props.ctx.adminPath}`;
const target = props.notebook ? { notebook: Number(props.notebook) } : { paper: Number(props.paper) };
const isNb = 'notebook' in target;
const MAX_PDF = 4 * 1024 * 1024;
const AIDS: [OutputKind, string][] = [
  ['briefing', 'Briefing'],
  ['faq', 'FAQ'],
  ['glossary', 'Glossary'],
];

interface Use {
  today: number;
  cap: number;
}
interface Room {
  title: string;
  papers: Paper[];
  texts: Record<number, TextState>;
  passages: Record<number, Passage[]>;
  outputs: Partial<Record<OutputKind, Output>>;
  highlights: Highlight[];
  use: Use;
  /** the notebooks a paper is in (a paper's room only) */
  inNotebooks: { id: number; title: string }[];
  /** the room's note in the vault, once there is one */
  vaultNote: number | null;
  /** the room's note on the public site */
  visibility: Visibility;
}
type PaperRes = Omit<Room, 'title' | 'papers' | 'texts' | 'passages' | 'inNotebooks'> & {
  paper: Paper;
  text: TextState;
  passages: Passage[];
  notebooks: Room['inNotebooks'];
  note: string;
};
type NotebookRes = Omit<Room, 'title' | 'inNotebooks'> & {
  notebook: { id: number; title: string };
  note: string;
};

const room = ref<Room | null>(null);
const loadError = ref('');
const shown = ref(0); // the paper in the paper pane
const note = ref('');
let savedNote = ''; // the note as last loaded or saved
let timer: ReturnType<typeof setInterval> | undefined;

async function load(first = false) {
  const open = first ? '?open=1' : ''; // opening fetches a text never fetched or failed; a poll doesn't
  try {
    let r: Room;
    let n: string;
    if (isNb) {
      const res = await api<NotebookRes>(`reading/notebooks/${target.notebook}${open}`);
      r = { ...res, title: res.notebook.title, inNotebooks: [] };
      n = res.note;
    } else {
      const res = await api<PaperRes>(`reading/papers/${target.paper}${open}`);
      r = {
        ...res,
        title: res.paper.title,
        papers: [res.paper],
        texts: { [res.paper.id]: res.text },
        passages: { [res.paper.id]: res.passages },
        inNotebooks: res.notebooks,
      };
      n = res.note;
    }
    room.value = r;
    if (first) note.value = savedNote = n;
    if (!r.papers.some((p) => p.id === shown.value)) shown.value = r.papers[0]?.id ?? 0;
  } catch (e) {
    stop();
    if (first) loadError.value = e instanceof Error ? e.message : String(e);
    else report(e);
    return;
  }
  // Poll while something is on its way: a run writing an output, or a text being fetched for the first time (for
  // PENDING_POLLS at most: a text-only run that died leaves it never fetched). A text with an error isn't polled: only
  // reopening fetches it again.
  const running = Object.values(room.value!.outputs).some((o) => o.status === 'running');
  const waiting = room.value!.papers.some(pending) && pendingPolls++ < PENDING_POLLS;
  if (running || waiting) timer ??= setInterval(load, 3000);
  else stop();
}
const PENDING_POLLS = 100; // 5 minutes: a notebook's texts wait 15 s apart on arXiv
let pendingPolls = 0;
function stop() {
  clearInterval(timer);
  timer = undefined;
}
const pending = (p: Paper) => {
  const t = room.value!.texts[p.id];
  return !!p.arxiv && !t.source && !t.error;
};

const cur = computed(() => room.value?.papers.find((p) => p.id === shown.value) ?? null);
const text = computed(() => (cur.value ? room.value!.texts[cur.value.id] : null));
const label = computed(() => text.value && textLabel(text.value));
const canUpload = computed(
  () => !!text.value && (text.value.source === 'abstract' || text.value.source === 'scan' || !!text.value.error),
);
const known = computed(
  () => new Set(Object.entries(room.value?.passages ?? {}).flatMap(([id, ps]) => ps.map((p) => `${id}:${p.pid}`))),
);
const scans = computed(
  () => new Set((room.value?.papers ?? []).filter((p) => room.value!.texts[p.id].source === 'scan').map((p) => p.id)),
);
const citeNames = computed(() => (isNb ? new Map(room.value?.papers.map((p) => [p.id, p])) : undefined));
const textReady = computed(
  () => !!room.value?.papers.every((p) => room.value!.texts[p.id].source && !room.value!.texts[p.id].error),
);
const meta = (p: Paper) =>
  [authorsLine(p.authors), SOURCE_NAMES[p.source] ?? p.source, p.publishedAt && formatDate(p.publishedAt)]
    .filter(Boolean)
    .join(' · ');

// Tabs: Summary · Chat · Notes beside the paper from 1024px; below that the paper is a tab too.
const wideQuery = matchMedia('(min-width: 1024px)');
const wide = ref(wideQuery.matches);
const onWide = () => (wide.value = wideQuery.matches);
const tab = ref(wide.value ? 'summary' : 'paper');
const tabs = computed(() => [
  ...(wide.value ? [] : [['paper', 'Paper']]),
  ['summary', 'Summary'],
  ['chat', 'Chat'],
  ['notes', 'Notes'],
]);
watch(wide, (w) => {
  if (w && tab.value === 'paper') tab.value = 'summary';
});
function onTabKey(e: KeyboardEvent) {
  const rtl = getComputedStyle(e.currentTarget as Element).direction === 'rtl';
  const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  const ids = tabs.value.map(([id]) => id);
  const n = ids.length;
  const at = ids.indexOf(tab.value);
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : step ? (at + step + n) % n : -1;
  if (to < 0) return;
  e.preventDefault();
  tab.value = ids[to];
  void nextTick(() => document.getElementById(`room-tab-${ids[to]}`)?.focus());
}
/** One tab row, rendered above the paper in one column and above the side pane in two. */
const TabList = () =>
  h(
    'div',
    { class: 'adm-filter adm-room-tabs', role: 'tablist', 'aria-label': 'Reading room', onKeydown: onTabKey },
    tabs.value.map(([id, name]) =>
      h(
        'button',
        {
          id: `room-tab-${id}`,
          type: 'button',
          role: 'tab',
          'aria-selected': tab.value === id ? 'true' : 'false',
          'aria-controls': `room-panel-${id}`,
          tabindex: tab.value === id ? 0 : -1,
          onClick: () => (tab.value = id),
        },
        name,
      ),
    ),
  );

// Citations: the paper shows the passage (switching tab and paper first), scrolls it to the middle, focuses and flashes it.
const flash = ref<Cite | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | undefined;
async function jump(c: Cite) {
  if (!wide.value) tab.value = 'paper';
  shown.value = c.paper;
  await nextTick();
  const el = document.getElementById(`psg-${c.paper}-${c.pid}`);
  if (!el) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  flash.value = c;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.value = null), 2000);
}

// Public or private: in a paper's room the toggle gives the paper its note when it has none; a notebook's room has
// the toggle once its note exists. Writes answer with whether the public copies updated.
const publishWarning = ref('');
const warned = (res: { publishWarning?: string } | null) => (publishWarning.value = res?.publishWarning ?? '');
const shared = computed(() => ({
  on: room.value?.highlights.filter((x) => x.public).length ?? 0,
  all: room.value?.highlights.length ?? 0,
}));
async function setPublic(on: boolean) {
  const res = await api<{ visibility: Visibility; publishWarning?: string }>('reading/vault/publish', {
    body: { paper: target.paper, public: on },
  });
  room.value!.vaultNote ??= res.visibility.noteId;
  return res;
}
const setNotebookPublic = (on: boolean) =>
  api<{ visibility: Visibility; publishWarning?: string }>(`reading/vault/notes/${room.value!.vaultNote}`, {
    method: 'PATCH',
    body: { public: on },
  });
const publicLabel = (hl: Highlight) => {
  const q = visible(hl.quote);
  return `Public: “${q.length > 40 ? `${q.slice(0, 40)}…` : q}”`;
};
/** A highlight's Public box: ticked at once, unticked again (with the route's sentence beside it) when refused. */
const hlError = ref<{ id: number; text: string } | null>(null);
async function setHighlightPublic(hl: Highlight, on: boolean) {
  hl.public = on;
  hlError.value = null;
  try {
    warned(await api(`reading/highlights/${hl.id}`, { method: 'PATCH', body: { public: on } }));
  } catch (e) {
    hl.public = !on;
    hlError.value = { id: hl.id, text: (e as Error).message };
  }
}

/** After a save, highlight or note: reload so the link to the new vault note appears. */
function toVault() {
  if (!room.value?.vaultNote) void load();
}

// Header actions.
async function toggleSave() {
  const p = cur.value!;
  try {
    p.state = (
      await api<{ state: Paper['state'] }>(`reading/papers/${p.id}`, {
        method: 'PATCH',
        body: { state: p.state === 'saved' ? 'new' : 'saved' },
      })
    ).state;
    toVault();
  } catch (e) {
    report(e);
  }
}
const notebooks = ref<{ id: number; title: string }[]>([]);
const addable = computed(() => notebooks.value.filter((n) => !room.value?.inNotebooks.some((m) => m.id === n.id)));
async function addToNotebook(e: Event) {
  const select = e.target as HTMLSelectElement;
  const choice = select.value;
  select.value = '';
  if (!choice) return;
  try {
    let id = Number(choice);
    let title = notebooks.value.find((n) => n.id === id)?.title;
    if (choice === 'new') {
      title = window.prompt('Notebook title')?.trim();
      if (!title) return;
      id = (await api<{ id: number }>('reading/notebooks', { body: { title } })).id;
    }
    await api(`reading/notebooks/${id}`, { method: 'PATCH', body: { add: target.paper } });
    toast(`Added to ${title}`);
    await Promise.all([load(), loadNotebooks()]);
  } catch (err) {
    report(err);
  }
}
async function loadNotebooks() {
  notebooks.value = (await api<{ notebooks: { id: number; title: string }[] }>('reading/notebooks')).notebooks;
}
async function patchNotebook(body: object) {
  try {
    await api(`reading/notebooks/${target.notebook}`, { method: 'PATCH', body });
    await load();
    return true;
  } catch (e) {
    report(e);
    return false;
  }
}
async function rename(e: Event) {
  const title = (e.target as HTMLInputElement).value.trim();
  if (title && title !== room.value!.title) await patchNotebook({ title });
}
const newRef = ref('');
const adding = ref(false);
async function addPaper() {
  if (!newRef.value.trim()) return;
  adding.value = true;
  pendingPolls = 0; // the added paper's text is fetched next
  if (await patchNotebook({ add: newRef.value.trim() })) newRef.value = '';
  adding.value = false;
}

// The paper pane: an upload for a paper without its full text, highlights on a selection.
const uploadError = ref('');
const uploading = ref(false);
watch(shown, () => (uploadError.value = ''));
async function upload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  uploadError.value = '';
  if (!file) return;
  if (file.size > MAX_PDF) return void (uploadError.value = 'PDFs up to 4 MB can be uploaded');
  uploading.value = true;
  try {
    await api(`reading/papers/${shown.value}/pdf`, { form: file });
    summaryAsked = false; // the upload cleared the summary written from the old text: write it again
    await load();
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    uploading.value = false;
  }
}

const pane = ref<HTMLElement | null>(null);
type Sel = NonNullable<ReturnType<typeof selectionInPassage>>;
/** The popup at a selection (Highlight, Comment) or at a clicked mark (its comment, Delete), placed in the pane. */
const tool = ref<
  | { at: { x: number; y: number }; kind: 'across' }
  | { at: { x: number; y: number }; kind: 'new'; pick: Sel; commenting: boolean; comment: string }
  | { at: { x: number; y: number }; kind: 'mark'; hl: Highlight; comment: string }
  | null
>(null);
function placeAt(rect: DOMRect) {
  const box = pane.value!.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.left - box.left, box.width - 280)),
    y: rect.bottom - box.top + pane.value!.scrollTop + 6,
  };
}
function onSelect(e: Event) {
  if ((e.target as Element).closest?.('.adm-room-tool')) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !pane.value?.contains(sel.anchorNode)) {
    if (tool.value?.kind !== 'mark') tool.value = null;
    return;
  }
  const at = placeAt(sel.getRangeAt(0).getBoundingClientRect());
  const pick = selectionInPassage(sel);
  tool.value = pick ? { at, kind: 'new', pick, commenting: false, comment: '' } : { at, kind: 'across' };
}
function onPaneClick(e: MouseEvent) {
  const mark = (e.target as Element).closest?.('mark[data-hl]');
  if (!mark || !getSelection()?.isCollapsed) return;
  openMark(mark, Number(mark.getAttribute('data-hl')!.split(' ')[0]));
}
function openMark(mark: Element, id: number) {
  const hl = room.value!.highlights.find((x) => x.id === id);
  if (hl) tool.value = { at: placeAt(mark.getBoundingClientRect()), kind: 'mark', hl, comment: hl.comment };
}
async function focusTool() {
  await nextTick();
  pane.value?.querySelector<HTMLElement>('.adm-room-tool textarea, .adm-room-tool button')?.focus();
}
async function saveHighlight() {
  const t = tool.value;
  if (t?.kind !== 'new') return;
  try {
    const { highlight } = await api<{ highlight: Highlight }>('reading/highlights', {
      body: { paper: shown.value, ...t.pick, comment: t.comment.trim() },
    });
    room.value!.highlights.push(highlight);
    getSelection()?.removeAllRanges();
    tool.value = null;
    toVault();
  } catch (e) {
    report(e);
  }
}
async function saveComment() {
  const t = tool.value;
  if (t?.kind !== 'mark') return;
  try {
    warned(await api(`reading/highlights/${t.hl.id}`, { method: 'PATCH', body: { comment: t.comment.trim() } }));
    const hl = room.value!.highlights.find((x) => x.id === t.hl.id); // a poll may have replaced t.hl
    if (hl) hl.comment = t.comment.trim();
    tool.value = null;
  } catch (e) {
    report(e);
  }
}
async function deleteHighlight() {
  const t = tool.value;
  if (t?.kind !== 'mark') return;
  try {
    warned(await api(`reading/highlights/${t.hl.id}`, { method: 'DELETE' }));
    room.value!.highlights = room.value!.highlights.filter((x) => x.id !== t.hl.id);
    tool.value = null;
  } catch (e) {
    report(e);
  }
}
/** From the Notes tab: go to the highlight's passage and open its comment there. */
async function showHighlight(hl: Highlight) {
  await jump({ paper: hl.paperId, pid: hl.pid });
  const mark = pane.value?.querySelector(`mark[data-hl~="${hl.id}"]`);
  if (mark) {
    openMark(mark, hl.id);
    await focusTool();
  }
}

// Summary and study aids: written by a background run; the room is polled while one runs.
let summaryAsked = false;
async function generate(kind: OutputKind) {
  try {
    await api('reading/outputs', { body: { ...target, kind } });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) return report(e); // 409: already running, so just poll
  }
  await load();
}
const outdated = (o: Output) =>
  isNb &&
  !!o.body &&
  [...o.body.papers].sort().join() !==
    room
      .value!.papers.map((p) => p.id)
      .sort()
      .join();
watch([tab, room], () => {
  if (tab.value !== 'summary' || !room.value || summaryAsked || room.value.outputs.summary) return;
  if (isNb && !room.value.papers.length) return;
  summaryAsked = true;
  void generate('summary');
});

// Chat.
const messages = ref<ChatMessage[]>([]);
const question = ref('');
const asking = ref(false);
const chatError = ref('');
const chatQuery = isNb ? `notebook=${target.notebook}` : `paper=${target.paper}`;
async function ask() {
  const q = question.value.trim();
  if (!q || asking.value) return;
  asking.value = true;
  chatError.value = '';
  try {
    const r = await api<{ question: ChatMessage; answer: ChatMessage }>('reading/chat', {
      body: { ...target, question: q },
    });
    messages.value.push(r.question, r.answer);
    question.value = '';
  } catch (e) {
    chatError.value = e instanceof Error ? e.message : String(e);
  } finally {
    asking.value = false;
    void load(); // today's AI use
    await nextTick();
    document.getElementById('room-question')?.focus();
  }
}
function onAskKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  void ask();
}
async function toggleSaved(m: ChatMessage) {
  try {
    m.saved = (
      await api<{ saved: boolean }>(`reading/chat/${m.id}`, { method: 'PATCH', body: { saved: !m.saved } })
    ).saved;
    toVault();
  } catch (e) {
    report(e);
  }
}

// Notes: saved on blur and a second after typing stops, one save at a time.
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let noteSaving = Promise.resolve();
const noteStatus = ref('');
function onNoteInput() {
  noteStatus.value = '';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(saveNote, 1000);
}
function saveNote() {
  clearTimeout(noteTimer);
  noteSaving = noteSaving.then(async () => {
    const body = note.value;
    if (body === savedNote) return;
    try {
      warned(await api('reading/notes', { method: 'PUT', body: { ...target, body } }));
      savedNote = body;
      noteStatus.value = 'Saved';
      toVault();
    } catch (e) {
      report(e);
    }
  });
  return noteSaving;
}
/** Before a draft: the room's latest note is saved, so the draft reads it. */
const noteSaved = async () => (await saveNote(), note.value === savedNote);
/** Leaving the page: the last edit goes with a keepalive request, which outlives the page. */
function flushNote() {
  if (note.value === savedNote) return;
  clearTimeout(noteTimer);
  void fetch('/api/admin/reading/notes', {
    method: 'PUT',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, body: note.value }),
  });
  savedNote = note.value;
}
const onHidden = () => document.visibilityState === 'hidden' && flushNote();
const paperTitle = (id: number) => visible(room.value?.papers.find((p) => p.id === id)?.title ?? '');

onMounted(async () => {
  wideQuery.addEventListener('change', onWide);
  addEventListener('pagehide', flushNote);
  document.addEventListener('visibilitychange', onHidden);
  await load(true);
  const [c, n] = await Promise.allSettled([
    api<{ messages: ChatMessage[] }>(`reading/chat?${chatQuery}`),
    isNb ? Promise.resolve() : loadNotebooks(),
  ]);
  if (c.status === 'fulfilled') messages.value = c.value.messages;
  else if (!loadError.value) report(c.reason);
  if (n.status === 'rejected' && !loadError.value) report(n.reason);
});
onBeforeUnmount(() => {
  stop();
  clearTimeout(flashTimer);
  wideQuery.removeEventListener('change', onWide);
  removeEventListener('pagehide', flushNote);
  document.removeEventListener('visibilitychange', onHidden);
});
</script>

<template>
  <AdminShell
    :ctx="ctx"
    :active="isNb ? 'reading/notebooks' : 'reading'"
    :title="room ? visible(room.title) : isNb ? 'Notebook' : 'Paper'"
  >
    <p v-if="loadError" class="adm-err" role="alert">{{ loadError }}</p>
    <p v-else-if="!room" class="adm-muted">Loading…</p>
    <template v-else>
      <div class="adm-room-head">
        <template v-if="!isNb && cur">
          <p class="adm-muted">{{ meta(cur) }}</p>
          <div class="adm-actions">
            <a :href="cur.url" class="adm-btn" target="_blank" rel="noopener noreferrer">Source</a>
            <button type="button" class="adm-btn" :aria-pressed="cur.state === 'saved'" @click="toggleSave">
              {{ cur.state === 'saved' ? 'Saved' : 'Save' }}
            </button>
            <select aria-label="Add to notebook" class="adm-room-add" @change="addToNotebook">
              <option value="">Add to notebook…</option>
              <option v-for="n in addable" :key="n.id" :value="n.id">{{ n.title }}</option>
              <option value="new">New notebook…</option>
            </select>
            <ReadingDraftButton
              :ctx="ctx"
              :from="{ paper: cur.id }"
              :before="noteSaved"
              hint="Writes an unpublished draft in your voice from this paper, your notes and saved answers, and opens it in the blog editor. One reading-room AI call."
            />
          </div>
          <p v-if="room.inNotebooks.length" class="adm-muted">
            In
            <span v-for="(n, i) in room.inNotebooks" :key="n.id"
              >{{ i ? ', ' : '' }}<a :href="`${base}/reading/notebooks/${n.id}`">{{ visible(n.title) }}</a></span
            >
          </p>
          <ReadingVisibility
            v-model:visibility="room.visibility"
            v-model:warning="publishWarning"
            :ctx="ctx"
            kind="paper"
            :shared="shared"
            :send="setPublic"
          />
        </template>
        <template v-else-if="isNb">
          <ReadingVisibility
            v-model:visibility="room.visibility"
            v-model:warning="publishWarning"
            :ctx="ctx"
            kind="free"
            :send="setNotebookPublic"
          />
          <label class="adm-field adm-room-title">
            <span>Title</span>
            <input type="text" :value="room.title" maxlength="200" @change="rename" />
          </label>
          <ul v-if="room.papers.length" class="adm-rows">
            <li v-for="p in room.papers" :key="p.id">
              <span class="adm-row-main">
                <a :href="`${base}/reading/papers/${p.id}`">{{ visible(p.title) }}</a>
                <span class="adm-row-detail">{{ meta(p) }}</span>
              </span>
              <span class="adm-row-action">
                <button
                  type="button"
                  class="adm-btn"
                  :aria-label="`Remove ${visible(p.title)}`"
                  @click="patchNotebook({ remove: p.id })"
                >
                  Remove
                </button>
              </span>
            </li>
          </ul>
          <form class="adm-actions" @submit.prevent="addPaper">
            <label class="adm-visually-hidden" for="room-add-ref">arXiv id or DOI</label>
            <input
              id="room-add-ref"
              v-model="newRef"
              type="text"
              class="adm-room-ref"
              placeholder="arXiv id or DOI"
              maxlength="300"
            />
            <button type="submit" class="adm-btn" :disabled="adding">{{ adding ? 'Adding…' : 'Add a paper' }}</button>
          </form>
          <ReadingDraftButton
            :ctx="ctx"
            :from="target"
            :before="noteSaved"
            hint="Writes an unpublished draft in your voice from this notebook’s papers (a roundup when it has several), its note and your saved answers, and opens it in the blog editor. One reading-room AI call."
          />
        </template>
      </div>

      <div class="adm-room">
        <TabList v-if="!wide" />
        <section
          v-if="wide || tab === 'paper'"
          ref="pane"
          class="adm-room-paper"
          v-bind="
            wide
              ? { 'aria-label': 'Paper' }
              : { id: 'room-panel-paper', role: 'tabpanel', 'aria-labelledby': 'room-tab-paper' }
          "
          @mouseup="onSelect"
          @keyup="onSelect"
          @click="onPaneClick"
          @keydown.esc="tool = null"
        >
          <h2 class="adm-visually-hidden">Paper</h2>
          <p v-if="!room.papers.length" class="adm-muted">Add a paper to this notebook to read it here.</p>
          <template v-if="cur && text">
            <label v-if="isNb" class="adm-field">
              <span>Paper</span>
              <select v-model="shown">
                <option v-for="p in room.papers" :key="p.id" :value="p.id">{{ visible(p.title) }}</option>
              </select>
            </label>
            <div v-if="label || canUpload" class="adm-room-label">
              <p v-if="label" class="adm-muted">{{ label }}</p>
              <label v-if="canUpload" class="adm-btn adm-room-upload">
                {{ uploading ? 'Uploading…' : 'Upload the PDF' }}
                <input type="file" accept="application/pdf" :disabled="uploading" @change="upload" />
              </label>
              <p v-if="uploadError" class="adm-err" role="alert">{{ uploadError }}</p>
            </div>
            <PaperText
              v-if="room.passages[cur.id].length"
              :paper-id="cur.id"
              :passages="room.passages[cur.id]"
              :highlights="room.highlights.filter((x) => x.paperId === cur!.id)"
              :arxiv="text.source === 'arxiv-html' ? cur.arxiv : null"
              :flash="flash?.paper === cur.id ? flash.pid : null"
            />
            <p v-else-if="cur.abstract" class="adm-paper-text">{{ visible(cur.abstract) }}</p>
          </template>
          <div
            v-if="tool"
            class="adm-room-tool"
            :style="{ insetInlineStart: `${tool.at.x}px`, insetBlockStart: `${tool.at.y}px` }"
          >
            <p v-if="tool.kind === 'across'" role="status">Select within one paragraph to highlight.</p>
            <template v-else-if="tool.kind === 'new'">
              <template v-if="tool.commenting">
                <label class="adm-visually-hidden" for="room-hl-comment">Comment</label>
                <textarea id="room-hl-comment" v-model="tool.comment" rows="3" maxlength="2000" />
                <button type="button" class="adm-btn adm-btn-primary" @click="saveHighlight">Save</button>
              </template>
              <template v-else>
                <button type="button" class="adm-btn" @click="saveHighlight">Highlight</button>
                <button type="button" class="adm-btn" @click="((tool.commenting = true), focusTool())">Comment</button>
              </template>
            </template>
            <template v-else>
              <label class="adm-visually-hidden" for="room-hl-comment">Comment</label>
              <textarea id="room-hl-comment" v-model="tool.comment" rows="3" maxlength="2000" placeholder="Comment" />
              <button type="button" class="adm-btn" @click="saveComment">Save</button>
              <button type="button" class="adm-btn" @click="deleteHighlight">Delete</button>
            </template>
          </div>
        </section>

        <div v-if="wide || tab !== 'paper'" class="adm-room-side">
          <TabList v-if="wide" />
          <div :id="`room-panel-${tab}`" role="tabpanel" :aria-labelledby="`room-tab-${tab}`" class="adm-room-panel">
            <template v-if="tab === 'summary'">
              <template v-for="k in ['summary', ...AIDS.map(([a]) => a)] as OutputKind[]" :key="k">
                <template v-if="k === 'summary' || room.outputs[k]">
                  <h2 :class="k === 'summary' ? 'adm-visually-hidden' : 'adm-h2'">
                    {{ k === 'summary' ? 'Summary' : AIDS.find(([a]) => a === k)![1] }}
                  </h2>
                  <div role="status">
                    <div v-if="room.outputs[k]?.status === 'running'" class="adm-verdict adm-run">
                      <p>{{ progressLine(room.outputs[k], textReady, isNb) }}</p>
                    </div>
                  </div>
                  <div v-if="room.outputs[k]?.status === 'failed'" class="adm-verdict adm-run is-attention">
                    <p>{{ visible(room.outputs[k]!.error ?? '') }}</p>
                    <button type="button" class="adm-btn" @click="generate(k)">Try again</button>
                  </div>
                  <template v-if="room.outputs[k]?.status === 'ready' && room.outputs[k]!.body">
                    <p v-if="outdated(room.outputs[k]!)" class="adm-muted">Papers changed since this was written.</p>
                    <ClaimList
                      :sections="room.outputs[k]!.body!.sections"
                      :papers="citeNames"
                      :known="known"
                      :scans="scans"
                      @cite="jump"
                    />
                    <div class="adm-actions">
                      <button type="button" class="adm-btn" @click="generate(k)">Regenerate</button>
                    </div>
                  </template>
                  <template v-if="k === 'summary' && !room.outputs.summary">
                    <div v-if="room.papers.length" class="adm-actions">
                      <button type="button" class="adm-btn adm-btn-primary" @click="generate('summary')">
                        Write the summary
                      </button>
                    </div>
                    <p v-else class="adm-muted">Add a paper to this notebook to write its summary.</p>
                  </template>
                </template>
                <template v-if="k === 'summary'">
                  <h2 class="adm-h2">Study aids</h2>
                  <div class="adm-actions">
                    <template v-for="[a, name] in AIDS" :key="a">
                      <button
                        v-if="!room.outputs[a]"
                        type="button"
                        class="adm-btn"
                        :disabled="!room.papers.length"
                        @click="generate(a)"
                      >
                        {{ name }}
                      </button>
                    </template>
                  </div>
                </template>
              </template>
            </template>

            <template v-else-if="tab === 'chat'">
              <h2 class="adm-visually-hidden">Chat</h2>
              <ol class="adm-room-chat">
                <li v-for="m in messages" :key="m.id" :class="m.role === 'user' ? 'is-question' : 'is-answer'">
                  <p v-if="m.role === 'user'">{{ m.body }}</p>
                  <template v-else>
                    <AnswerText :body="m.body" :papers="citeNames" :known="known" :scans="scans" @cite="jump" />
                    <button type="button" class="adm-btn" :aria-pressed="m.saved" @click="toggleSaved(m)">
                      Save to notes
                    </button>
                  </template>
                </li>
              </ol>
              <p v-if="asking" class="adm-muted" role="status">Thinking…</p>
              <p v-if="chatError" class="adm-err" role="alert">{{ chatError }}</p>
              <form class="adm-room-ask" @submit.prevent="ask">
                <label class="adm-visually-hidden" for="room-question">Question</label>
                <textarea
                  id="room-question"
                  v-model="question"
                  rows="3"
                  maxlength="2000"
                  :disabled="asking"
                  placeholder="Ask about this paper"
                  @keydown="onAskKey"
                />
                <button type="submit" class="adm-btn adm-btn-primary" :disabled="asking">Ask</button>
              </form>
              <p class="adm-muted">{{ room.use.today }} of {{ room.use.cap }} AI calls used today</p>
            </template>

            <template v-else-if="tab === 'notes'">
              <h2 class="adm-visually-hidden">Notes</h2>
              <label class="adm-field">
                <span>Note</span>
                <textarea v-model="note" rows="8" maxlength="20000" @input="onNoteInput" @blur="saveNote" />
              </label>
              <p class="adm-muted" role="status">{{ noteStatus }}</p>
              <template v-if="room.highlights.length">
                <h3 class="adm-subhead">Highlights</h3>
                <p id="room-hl-public-hint" class="adm-muted">Shown publicly up to 300 characters.</p>
                <ul class="adm-rows">
                  <li v-for="hl in room.highlights" :key="hl.id">
                    <span class="adm-row-main">
                      <button type="button" class="adm-room-quote" @click="showHighlight(hl)">
                        “{{ visible(hl.quote) }}”
                      </button>
                      <span v-if="hl.comment" class="adm-row-detail">{{ hl.comment }}</span>
                      <span v-if="isNb" class="adm-row-detail">{{ paperTitle(hl.paperId) }}</span>
                      <span v-if="hlError?.id === hl.id" class="adm-row-detail adm-err" role="alert">{{
                        hlError.text
                      }}</span>
                    </span>
                    <label class="adm-row-action adm-check">
                      <input
                        type="checkbox"
                        :checked="hl.public"
                        :aria-label="publicLabel(hl)"
                        aria-describedby="room-hl-public-hint"
                        @change="setHighlightPublic(hl, ($event.target as HTMLInputElement).checked)"
                      />
                      Public
                    </label>
                  </li>
                </ul>
              </template>
              <template v-if="messages.some((m) => m.saved)">
                <h3 class="adm-subhead">Saved answers</h3>
                <AnswerText
                  v-for="m in messages.filter((x) => x.saved)"
                  :key="m.id"
                  :body="m.body"
                  :papers="citeNames"
                  :known="known"
                  :scans="scans"
                  @cite="jump"
                />
              </template>
              <p v-if="room.vaultNote">
                <a :href="`${base}/reading/vault/${room.vaultNote}`">{{
                  isNb ? 'Open this notebook’s note in the vault' : 'Open this paper’s note in the vault'
                }}</a>
              </p>
              <p v-else class="adm-muted">
                {{
                  isNb
                    ? 'Writing a note here adds it to the vault.'
                    : 'Saving, highlighting or writing a note here adds this paper to the vault.'
                }}
              </p>
            </template>
          </div>
        </div>
      </div>
    </template>
  </AdminShell>
</template>
