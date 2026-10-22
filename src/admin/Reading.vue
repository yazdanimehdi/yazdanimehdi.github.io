<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AdminTabLinks from './AdminTabLinks.vue';
import AdminShell from './AdminShell.vue';
import { api, report, toast } from './api';
import { formatDate, relativeTime } from './dates';
import { isRunning, visible } from './career';
import { SOURCE_NAMES, authorsLine, dayLine, readingRunLine, readingRunNotes, thinLine } from './reading';
import type { AdminCtx } from './types';
import type { ReadingPrefs } from '../lib/reading/settings';
import type { DigestItem, DigestSection, PaperState, ReadingRun } from '../lib/reading/types';

// Titles, authors and lines are third-party text (or the AI's): shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const SECTIONS: [DigestSection, string][] = [
  ['talked', 'People are talking about'],
  ['field', 'New in your field'],
  ['unranked', 'Not ranked tonight'],
];
const WEEK = 7;

interface Day {
  day: string;
  items: DigestItem[];
}
interface RunStatus {
  runId: string | null;
  status: string | null;
  lastRun: ReadingRun | null;
}

const days = ref<Day[]>([]);
const more = ref(false);
const loading = ref(true);
const loadingMore = ref(false);
const prefs = ref<ReadingPrefs | null>(null);
const run = ref<RunStatus>({ runId: null, status: null, lastRun: null });
const runKnown = ref(false);
const starting = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const running = computed(() => starting.value || isRunning(run.value.status));

const newest = computed(() => days.value[0] ?? null);
const earlier = computed(() => days.value.slice(1).filter((d) => d.items.length));
const inSection = (d: Day, s: DigestSection) => d.items.filter((i) => i.section === s);
/** Under a short section of the newest day: why it is short, only when the last run built that day. */
function thin(s: DigestSection): string | null {
  const last = run.value.lastRun;
  if (s === 'unranked' || !prefs.value || !newest.value || last?.day !== newest.value.day) return null;
  const max = s === 'talked' ? prefs.value.talked : prefs.value.inField;
  return thinLine(s, inSection(newest.value, s).length, max, prefs.value.area, last);
}
const meta = (i: DigestItem) =>
  [
    authorsLine(i.paper.authors),
    SOURCE_NAMES[i.paper.source] ?? i.paper.source,
    i.paper.publishedAt && formatDate(i.paper.publishedAt),
  ]
    .filter(Boolean)
    .join(' · ');

/** The newest day and a week before it in one request; later pages a week at a time. */
async function load(before?: string) {
  const n = before ? WEEK : WEEK + 1;
  try {
    const res = await api<{ days: Day[] }>(`reading/digest?days=${n}${before ? `&before=${before}` : ''}`);
    days.value = before ? [...days.value, ...res.days] : res.days;
    more.value = res.days.length === n;
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
}
async function showEarlier() {
  loadingMore.value = true;
  await load(days.value.at(-1)!.day);
  loadingMore.value = false;
}

async function setState(id: number, state: PaperState) {
  await api(`reading/papers/${id}`, { method: 'PATCH', body: { state } });
  for (const d of days.value) for (const i of d.items) if (i.paper.id === id) i.paper.state = state;
}
async function toggleSave(i: DigestItem) {
  try {
    await setState(i.paper.id, i.paper.state === 'saved' ? 'new' : 'saved');
  } catch (e) {
    report(e);
  }
}

const rowKey = (d: Day, i: DigestItem) => `${d.day}-${i.paper.id}`;
function focusIn(key: string | null, selector: string) {
  void nextTick(() => {
    const row = key ? document.querySelector(`[data-row="${key}"]`) : null;
    (row?.querySelector<HTMLElement>(selector) ?? document.getElementById('adm-main'))?.focus();
  });
}

/**
 * A dismissed paper leaves every day it was listed on (the server hides it there too), and focus moves to the next
 * row's Dismiss. Undo puts it back where it was and returns focus to its Dismiss.
 */
async function dismiss(d: Day, i: DigestItem) {
  const was = i.paper.state;
  const at = days.value.map((x) => x.items.findIndex((y) => y.paper.id === i.paper.id));
  const list = d.items;
  const next = list[list.indexOf(i) + 1] ?? list[list.indexOf(i) - 1];
  try {
    await setState(i.paper.id, 'dismissed');
  } catch (e) {
    return report(e);
  }
  const removed = days.value.map((x, n) => (at[n] < 0 ? null : x.items.splice(at[n], 1)[0]));
  focusIn(next ? rowKey(d, next) : null, '.adm-reading-dismiss');
  toast('Dismissed', undefined, {
    label: 'Undo',
    run: async () => {
      try {
        await setState(i.paper.id, was);
      } catch (e) {
        return report(e);
      }
      days.value.forEach((x, n) => {
        const item = removed[n];
        if (item) x.items.splice(Math.min(at[n], x.items.length), 0, { ...item, paper: { ...item.paper, state: was } });
      });
      focusIn(rowKey(d, i), '.adm-reading-dismiss');
    },
  });
}

async function poll() {
  try {
    run.value = await api<RunStatus>('reading/run');
  } catch (e) {
    stop();
    return report(e);
  }
  if (!isRunning(run.value.status)) {
    stop();
    await load();
  }
}
function stop() {
  clearInterval(timer);
  timer = undefined;
}
function watch() {
  if (!timer) timer = setInterval(poll, 5000);
}
async function runNow() {
  starting.value = true;
  try {
    const res = await api<{ runId?: string; running?: boolean }>('reading/run', { method: 'POST' });
    if (res.running) toast('A run is already in progress');
    run.value = { ...run.value, status: 'running' };
    watch();
  } catch (e) {
    report(e);
  } finally {
    starting.value = false;
  }
}

onMounted(async () => {
  void load();
  const [s, r] = await Promise.allSettled([
    api<{ prefs: ReadingPrefs }>('reading/settings'),
    api<RunStatus>('reading/run'),
  ]);
  if (s.status === 'fulfilled') prefs.value = s.value.prefs;
  else report(s.reason);
  runKnown.value = true;
  if (r.status === 'fulfilled') {
    run.value = r.value;
    if (isRunning(run.value.status)) watch();
  } else report(r.reason);
});
onBeforeUnmount(stop);
</script>

<template>
  <AdminShell :ctx="ctx" active="reading" title="Reading">
    <AdminTabLinks
      label="Reading"
      :tabs="[
        { href: `${base}/reading`, label: 'Today', current: true },
        { href: `${base}/reading/library`, label: 'Library' },
        { href: `${base}/reading/notebooks`, label: 'Notebooks' },
        { href: `${base}/reading/settings`, label: 'Settings' },
      ]"
    />
    <div v-if="!runKnown" class="adm-verdict" aria-hidden="true"><span class="adm-skel-bar" /></div>
    <div v-else class="adm-verdict adm-run" :class="{ 'is-attention': run.status === 'failed' }">
      <p role="status">
        <template v-if="run.status === 'failed'">The last run failed. </template>
        <template v-if="run.lastRun">
          {{ run.status === 'failed' ? 'Last finished run' : 'Last run' }} {{ relativeTime(run.lastRun.at) }} ·
          {{ readingRunLine(run.lastRun) }}
        </template>
        <template v-else-if="run.status !== 'failed'">No run yet. The digest runs every night.</template>
      </p>
      <button type="button" class="adm-btn adm-btn-primary" :disabled="running" @click="runNow">
        {{ running ? 'Running…' : 'Run now' }}
      </button>
    </div>
    <template v-if="run.lastRun">
      <div v-if="readingRunNotes(run.lastRun).length" class="adm-run-notes" role="status">
        <p v-for="note in readingRunNotes(run.lastRun)" :key="note" class="adm-err">{{ note }}</p>
      </div>
      <details v-if="run.lastRun.sources.length" class="adm-nav-more" :open="run.lastRun.sources.some((s) => s.error)">
        <summary>By source ({{ run.lastRun.sources.length }})</summary>
        <ul class="adm-rows">
          <li v-for="s in run.lastRun.sources" :key="s.id">
            <span class="adm-row-label">{{ SOURCE_NAMES[s.id] ?? s.id }}</span>
            <span class="adm-row-main">
              found {{ s.found }} · added {{ s.added }}
              <span v-if="s.skipped" class="adm-row-detail">Skipped: {{ visible(s.skipped) }}</span>
              <span v-if="s.error" class="adm-row-detail adm-err">{{ visible(s.error) }}</span>
            </span>
          </li>
        </ul>
      </details>
    </template>

    <p v-if="loading" class="adm-muted">Loading…</p>
    <p v-else-if="!newest" class="adm-muted">
      No digest yet. Choose your field and sources in <a :href="`${base}/reading/settings`">Settings</a>; the digest
      arrives every morning.
    </p>
    <template v-else>
      <template v-for="[s, head] in SECTIONS" :key="s">
        <template v-if="inSection(newest, s).length || thin(s)">
          <h2 class="adm-h2">{{ head }}</h2>
          <ul v-if="inSection(newest, s).length" class="adm-rows">
            <li v-for="i in inSection(newest, s)" :key="i.paper.id" :data-row="rowKey(newest, i)">
              <span class="adm-row-main">
                <a :href="`${base}/reading/papers/${i.paper.id}`">{{ visible(i.paper.title) }}</a>
                <span class="adm-row-detail"
                  >{{ meta(i) }} · <a :href="i.paper.url" target="_blank" rel="noopener noreferrer">Source</a></span
                >
                <span class="adm-row-detail">{{ visible(i.line) }}</span>
              </span>
              <span class="adm-row-action adm-reading-actions">
                <button type="button" class="adm-btn" :aria-pressed="i.paper.state === 'saved'" @click="toggleSave(i)">
                  {{ i.paper.state === 'saved' ? 'Saved' : 'Save' }}
                </button>
                <button type="button" class="adm-btn adm-reading-dismiss" @click="dismiss(newest, i)">Dismiss</button>
              </span>
            </li>
          </ul>
          <p v-if="thin(s)" class="adm-muted">{{ thin(s) }}</p>
        </template>
      </template>

      <template v-if="earlier.length || more">
        <h2 class="adm-h2">Earlier days</h2>
        <details v-for="d in earlier" :key="d.day" class="adm-nav-more">
          <summary>{{ dayLine(d.day, d.items.length) }}</summary>
          <ul class="adm-rows">
            <li v-for="i in d.items" :key="i.paper.id" :data-row="rowKey(d, i)">
              <span class="adm-row-main">
                <a :href="`${base}/reading/papers/${i.paper.id}`">{{ visible(i.paper.title) }}</a>
                <span class="adm-row-detail"
                  >{{ meta(i) }} · <a :href="i.paper.url" target="_blank" rel="noopener noreferrer">Source</a></span
                >
                <span class="adm-row-detail">{{ visible(i.line) }}</span>
              </span>
              <span class="adm-row-action adm-reading-actions">
                <button type="button" class="adm-btn" :aria-pressed="i.paper.state === 'saved'" @click="toggleSave(i)">
                  {{ i.paper.state === 'saved' ? 'Saved' : 'Save' }}
                </button>
                <button type="button" class="adm-btn adm-reading-dismiss" @click="dismiss(d, i)">Dismiss</button>
              </span>
            </li>
          </ul>
        </details>
        <div v-if="more" class="adm-actions">
          <button type="button" class="adm-btn" :disabled="loadingMore" @click="showEarlier">
            {{ loadingMore ? 'Loading…' : 'Show earlier' }}
          </button>
        </div>
      </template>
    </template>
  </AdminShell>
</template>
