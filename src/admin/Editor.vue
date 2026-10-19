<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, committed, report, toast, toastError } from './api';
import { formatDateTime, relativeTime } from './dates';
import { vDialog } from './dialog';
import {
  README,
  agentLabel,
  changedPages,
  diffLines,
  elapsed,
  explain,
  failureLine,
  groupFiles,
  providerLabel,
  stepItems,
} from './editor/site';
import type { AdminCtx } from './types';
import type { EditorStatus, PublishResult } from '../lib/admin/editor';
import { defaultCommitMessage } from '../lib/admin/editor-message';

type Busy = '' | 'start' | 'end' | 'over' | 'run' | 'stop' | 'discard' | 'publish' | 'revert' | 'undo';
type Confirm = 'publish' | 'discard' | 'over' | 'undo';

const props = defineProps<{ ctx: AdminCtx }>();
/** Desktop preview: the site laid out at this width, scaled down to the preview column. */
const DESKTOP_WIDTH = 1280;
const status = ref<EditorStatus | null>(null);
const loadError = ref('');
const busy = ref<Busy>('');
const prompt = ref('');
const promptError = ref('');
const phone = ref(false);
const confirming = ref<Confirm | null>(null);
const message = ref('');
/** The last publish from this screen: the review area ends on it until the next change. */
const published = ref<PublishResult | null>(null);
// Bumped when the preview's content changes under it (a run ended, a discard): the iframe reloads.
const previewKey = ref(0);
/** The page the preview shows, set from "Changed on". */
const previewPath = ref('/');
const now = ref(Date.now());
const promptEl = ref<HTMLTextAreaElement | null>(null);
const logEl = ref<HTMLElement | null>(null);
const doneEl = ref<HTMLElement | null>(null);
const runEl = ref<HTMLElement | null>(null);
const reviewEl = ref<HTMLElement | null>(null);
const sessionEl = ref<HTMLDetailsElement | null>(null);
const viewportEl = ref<HTMLElement | null>(null);
/** The preview column's width, from a ResizeObserver: Desktop scales a 1280px-wide page down to it. */
const viewportWidth = ref(DESKTOP_WIDTH);
/** The width presets are hidden on phones (admin.css), where the preview is the phone's own width. */
const smallScreen = window.matchMedia('(max-width: 640px)');
const small = ref(smallScreen.matches);
/** Review mode tucks the request box under "Ask for another change". */
const askOpen = ref(false);
const diffOpen = ref(false);
/** After a publish: true once this deployment (the admin's own) is built from the published commit. */
const deployed = ref(false);
/** While the status polls for that deployment: the Published line carries the working marker. */
const deploying = ref(false);
let alive = true;
/** The log follows new output until the reader scrolls up, and again once they scroll back to the end. */
let followLog = true;
let poll: ReturnType<typeof setTimeout> | undefined;
let clock: ReturnType<typeof setInterval> | undefined;

const ai = `/${props.ctx.adminPath}/ai`;
/** Everyone else can ask, run and discard; their changes wait for a publisher (site.yml `publishers`). */
const publisher = props.ctx.canPublish;
/** What a reviewer does next, in the status line. */
const decide = publisher ? 'publish or discard' : 'ask for more or discard';
const SMALL_DIFF = 150;
const shortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ Enter' : 'Ctrl Enter';
const FILE_STATUS = { added: 'new', modified: 'changed', deleted: 'deleted' } as const;
const SERVER_NOTE =
  'Changed pages (.astro files) can run code when they load. If you’re unsure, share the preview with someone technical first.';

const ready = computed(() => (status.value?.state === 'ready' ? status.value : null));
const run = computed(() => ready.value?.run);
const running = computed(() => !!run.value?.running);
const outcome = computed(() => {
  const r = run.value;
  if (!r || r.running) return null;
  return r.exitCode === 0 ? 'done' : r.exitCode === undefined ? 'stopped' : 'failed';
});
/** The last run ended without finishing: Publish stays possible, but Try again (or Discard) leads. */
const unfinished = computed(() => outcome.value === 'failed' || outcome.value === 'stopped');
const notice = computed(() => {
  const s = status.value;
  if (!s) return null;
  const raw = s.state === 'unavailable' ? s.reason : s.blocked;
  return raw ? explain(raw) : null;
});
const files = computed(() => ready.value?.files ?? []);
const allowed = computed(() => files.value.filter((f) => f.allowed));
const refused = computed(() => files.value.filter((f) => !f.allowed));
const groups = computed(() => groupFiles(files.value));
const changedOn = computed(() => changedPages(allowed.value.map((f) => f.path)));
/** In Postgres mode a publish that saves documents isn't undoable (editor.ts sets `published.undoable` to match). */
const content = computed(() => allowed.value.some((f) => f.document));
const serverCode = computed(() => allowed.value.some((f) => f.status !== 'deleted' && f.path.endsWith('.astro')));
const lines = computed(() => diffLines(ready.value?.diff ?? ''));
const timer = computed(() => (run.value?.running ? elapsed(now.value - Date.parse(run.value.startedAt)) : ''));
const reviewing = computed(() => files.value.length > 0 && !running.value);
/** This screen's last publish, until the next change: the Published panel. */
const publishedPanel = computed(() => !!published.value && !files.value.length && !running.value);
/** The server's word, so it survives a reload: the last publish was code alone, and nothing newer is unpublished. */
const undoable = computed(() => !!ready.value?.published?.undoable && !files.value.length && !running.value);
/** First use and the resting state get the full introduction; every other state keeps it behind "How this works". */
const intro = computed(() => {
  const s = status.value;
  if (!s || s.state === 'unavailable' || s.state === 'none') return true;
  return s.state === 'ready' && !s.run && !s.files.length && !published.value;
});
const failed = computed(() => (outcome.value === 'failed' ? failureLine(ready.value?.log ?? '') : ''));
/** Someone else asked for one of the changes: each request then says who asked. */
const others = computed(() => !!ready.value?.requests.some((r) => r.by !== props.ctx.user?.login));
/** Diff anchors, one per file, for the file list's links. */
const hunkIds = computed(
  () => new Map(lines.value.flatMap((l, i) => (l.file ? [[l.file, `adm-editor-hunk-${i}`] as const] : []))),
);
const live = computed(() => {
  const r = published.value;
  if (!r?.commit) return 'Your changes are live.';
  if (deployed.value) return 'Your live site is updated.';
  return props.ctx.mode === 'postgres' && r.documents?.length
    ? 'Content changes are live; code changes go live in about a minute.'
    : 'Your live site updates in about a minute.';
});
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** A path's segments, each ending in its slash: the list puts a <wbr> after each, so paths wrap only there. */
const segments = (path: string) => path.split(/(?<=\/)/);
/** Never below 0.6, where the page stops being readable: past that the preview scrolls sideways instead. */
const scale = computed(() =>
  phone.value || small.value ? 1 : Math.max(0.6, Math.min(1, viewportWidth.value / DESKTOP_WIDTH)),
);
/** A page of the preview, by route. */
const previewHref = (path: string) => (ready.value ? new URL(path, ready.value.previewUrl).href : '');

const line = computed(() => {
  if (busy.value === 'start' || busy.value === 'over')
    return 'Starting… The first start copies and installs your site, which takes about a minute.';
  if (busy.value === 'stop') return 'Stopping the agent…';
  if (busy.value === 'publish') return 'Publishing…';
  if (busy.value === 'undo') return 'Undoing the last publish…';
  const s = status.value;
  if (!s || s.state === 'unavailable') return '';
  if (s.state === 'none') return 'Not started. Start makes a private copy of your site for the agent to work in.';
  if (s.state === 'stopped') return 'Paused. Resume picks up where you left off, unpublished changes included.';
  if (running.value)
    return `Working on your request… Your live site stays as it is until ${publisher ? 'you publish' : 'it’s published'}.`;
  const sofar = files.value.length ? ' What it changed so far is below.' : '';
  if (outcome.value === 'failed') return `The agent ran into a problem and didn’t finish.${sofar}`;
  if (outcome.value === 'stopped') return 'Stopped before it finished. Whatever it changed so far is kept.';
  if (outcome.value === 'done')
    return files.value.length
      ? `Done. Check the preview, then ${decide}.`
      : 'Done, but nothing changed. Try describing the change another way.';
  if (publishedPanel.value) return '';
  if (files.value.length) return `Check the preview, then ${decide}.`;
  return 'Ready. Describe a change.';
});
/** The status line's marker: a shape per state, so colour is never the only sign. */
const tone = computed(() => {
  if (busy.value || running.value) return 'working';
  if (outcome.value === 'failed') return 'failed';
  return outcome.value === 'done' && files.value.length ? 'done' : 'ready';
});

const CONFIRM = computed(() => ({
  publish: {
    title: 'Publish these changes?',
    text: content.value
      ? 'Code changes go live in about a minute and content changes at once. A publish with content changes can’t be undone from this screen.'
      : 'Your live site updates in about a minute. You can undo this from this screen until you publish again or something else changes these files.',
    action: 'Publish',
  },
  discard: {
    title: 'Discard all changes?',
    text: 'Every file goes back to how it was when you last published or started. This can’t be undone.',
    action: 'Discard changes',
  },
  over: {
    title: 'Start over?',
    text: 'This throws away your private copy and its unpublished changes, then starts again from a fresh copy of your live site. What you already published stays.',
    action: 'Start over',
  },
  undo: {
    title: 'Undo this publish?',
    text: 'Your live site goes back to how it was before this publish, in about a minute. The undo is saved in your site’s history too, so nothing is lost.',
    action: 'Undo publish',
  },
}));

function settle(next: EditorStatus) {
  const wasRunning = running.value;
  status.value = next;
  loadError.value = '';
  if (wasRunning && !running.value) {
    previewKey.value++;
    void afterRun();
  }
  clearTimeout(poll);
  if (running.value) poll = setTimeout(load, 2000);
}

/** A run just ended: focus goes to what comes next, unless the reader already moved it somewhere that stayed. */
async function afterRun() {
  await nextTick();
  const at = document.activeElement;
  if (at && at !== document.body) return;
  (files.value.length ? reviewEl : runEl).value?.focus();
}

async function load() {
  try {
    settle(await api<EditorStatus>('editor/session'));
  } catch (e) {
    clearTimeout(poll);
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

async function act(kind: Busy, call: () => Promise<void>) {
  busy.value = kind;
  try {
    await call();
  } catch (e) {
    report(e);
  } finally {
    busy.value = '';
  }
}

const start = () => act('start', async () => settle(await api<EditorStatus>('editor/session', { method: 'POST' })));
const pause = () => act('end', async () => settle(await api<EditorStatus>('editor/session', { method: 'DELETE' })));
const stop = () => act('stop', async () => settle(await api<EditorStatus>('editor/runs', { method: 'DELETE' })));

/** Run, or Try again with the last request: the box empties only once the run has started. */
function submit(text = prompt.value) {
  if (!text.trim()) {
    promptError.value = 'Describe a change first.';
    promptEl.value?.focus();
    return;
  }
  promptError.value = '';
  void act('run', async () => {
    await api('editor/runs', { body: { prompt: text } });
    prompt.value = '';
    published.value = null;
    askOpen.value = false;
    followLog = true;
    await load();
    await nextTick();
    runEl.value?.focus();
  });
}

async function editRequest() {
  prompt.value = run.value?.prompt ?? '';
  askOpen.value = true;
  await nextTick();
  promptEl.value?.focus();
}

const onAskToggle = (e: Event) => (askOpen.value = (e.target as HTMLDetailsElement).open);

async function jump(path: string) {
  diffOpen.value = true;
  await nextTick();
  const el = document.getElementById(hunkIds.value.get(path) ?? '');
  el?.scrollIntoView({ block: 'start' });
  el?.focus({ preventScroll: true });
}

/** Polls this deployment's commit until it is the published one; gives up quietly (the text stays "about a minute"). */
async function watchDeploy(id: string) {
  deployed.value = false;
  deploying.value = true;
  try {
    for (let i = 0; i < 30 && alive && published.value?.commit?.id === id; i++) {
      const r = await api<{ commit: string | null }>('editor/deployment').catch(() => null);
      if (!r?.commit) return;
      if (r.commit === id) return void (deployed.value = true);
      await new Promise((done) => setTimeout(done, 10_000));
    }
  } finally {
    deploying.value = false;
  }
}

function onPromptKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  }
}

const revert = (path: string) =>
  act('revert', async () => {
    settle(await api<EditorStatus>('editor/revert', { body: { path } }));
    previewKey.value++;
    toast(`Undid the change to ${path}. The other changes may depend on it, so check the preview again.`);
  });

/** Closes the Session menu with focus on its button, where a confirm opened from it gives focus back. */
function closeSession() {
  const menu = sessionEl.value;
  if (!menu?.open) return;
  menu.open = false;
  menu.querySelector('summary')?.focus();
}

/** Focus moving elsewhere closes the Session menu; a click that moves no focus (Safari's) is onOutsideClick's. */
function onSessionFocusOut(e: FocusEvent) {
  const menu = sessionEl.value;
  const to = e.relatedTarget as Node | null;
  if (menu && to && !menu.contains(to)) menu.open = false;
}

function onOutsideClick(e: MouseEvent) {
  const menu = sessionEl.value;
  if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
}

async function showPage(path: string) {
  previewPath.value = path;
  await nextTick();
  viewportEl.value?.scrollIntoView({ block: 'nearest' });
}

function openPublish() {
  message.value = defaultCommitMessage((ready.value?.requests ?? []).map((r) => r.prompt));
  confirming.value = 'publish';
}

async function copySteps() {
  try {
    await navigator.clipboard.writeText(notice.value?.steps ?? '');
    toast('Setup steps copied');
  } catch {
    toastError('Couldn’t copy. The same steps are in the README, section “Site editor”.');
  }
}

async function confirmed() {
  const kind = confirming.value;
  confirming.value = null;
  if (kind === 'discard') {
    await act('discard', async () => {
      settle(await api<EditorStatus>('editor/changes', { method: 'DELETE' }));
      previewKey.value++;
    });
    await nextTick();
    promptEl.value?.focus();
  } else if (kind === 'over') {
    await act('over', async () => {
      settle(await api<EditorStatus>('editor/start-over', { method: 'POST' }));
      published.value = null;
      previewKey.value++;
    });
  } else if (kind === 'publish') {
    await act('publish', async () => {
      const r = await api<PublishResult>('editor/publish', { body: { message: message.value } });
      if (r.warning) committed({ url: r.commit?.url, warning: r.warning, tags: r.tags, detail: r.detail });
      published.value = r;
      await load();
      await nextTick();
      doneEl.value?.focus();
      if (r.commit) void watchDeploy(r.commit.id);
    });
  } else if (kind === 'undo') {
    await act('undo', async () => {
      settle(await api<EditorStatus>('editor/undo-publish', { body: { commit: ready.value?.published?.id } }));
      published.value = null;
      previewKey.value++;
      toast('Undone. Your live site goes back in about a minute.', ready.value?.published?.url);
      await nextTick();
      promptEl.value?.focus();
    });
  }
}

function onLogScroll() {
  const el = logEl.value;
  if (el) followLog = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

watch(
  () => ready.value?.log,
  async () => {
    if (!followLog) return;
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  },
);

watch(
  () => ready.value?.diff,
  () => (diffOpen.value = lines.value.length <= SMALL_DIFF),
  { immediate: true },
);

watch(running, (on) => {
  clearInterval(clock);
  now.value = Date.now();
  if (on) clock = setInterval(() => (now.value = Date.now()), 1000);
});

const onSmall = (e: MediaQueryListEvent) => (small.value = e.matches);
const resize = new ResizeObserver((entries) => (viewportWidth.value = entries[0].contentRect.width));
watch(viewportEl, (el, old) => {
  if (old) resize.unobserve(old);
  if (el) resize.observe(el);
});

onMounted(() => {
  smallScreen.addEventListener('change', onSmall);
  document.addEventListener('click', onOutsideClick);
  void load();
});
onBeforeUnmount(() => {
  alive = false;
  resize.disconnect();
  smallScreen.removeEventListener('change', onSmall);
  document.removeEventListener('click', onOutsideClick);
  clearTimeout(poll);
  clearInterval(clock);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="editor" title="Site editor">
    <template #actions>
      <!-- While a setup notice shows, Start and Start over can't work: the notice's own action is the way on. -->
      <template v-if="!notice && status">
        <button
          v-if="status.state === 'none' || status.state === 'stopped'"
          type="button"
          class="adm-btn adm-btn-primary"
          :disabled="!!busy"
          @click="start"
        >
          {{ busy === 'start' ? 'Starting…' : status.state === 'stopped' ? 'Resume' : 'Start' }}
        </button>
        <button
          v-if="status.state === 'stopped'"
          type="button"
          class="adm-btn"
          :disabled="!!busy"
          @click="confirming = 'over'"
        >
          Start over…
        </button>
      </template>
      <details
        v-if="ready"
        ref="sessionEl"
        class="adm-editor-session"
        @keydown.esc="closeSession"
        @focusout="onSessionFocusOut"
      >
        <summary class="adm-btn">Session</summary>
        <div class="adm-editor-session-menu">
          <button
            type="button"
            class="adm-btn"
            :disabled="!!busy || running"
            @click="
              closeSession();
              pause();
            "
          >
            Pause
          </button>
          <button
            v-if="!notice"
            type="button"
            class="adm-btn"
            :disabled="!!busy || running"
            @click="
              closeSession();
              confirming = 'over';
            "
          >
            Start over…
          </button>
          <p v-if="running" class="adm-muted">Stop the agent first.</p>
        </div>
      </details>
    </template>

    <div class="adm-editor-page" :class="{ 'is-review': reviewing }">
      <component :is="intro ? 'div' : 'details'" class="adm-editor-how">
        <summary v-if="!intro">How this works</summary>
        <p class="adm-editor-intro">
          Describe a change to your site’s design or pages. A coding agent makes it in a private copy of the site, you
          check it in the preview, and {{ publisher ? 'Publish' : 'a publisher' }} puts it on your live site. The admin,
          sign-in, server code and dependencies are off limits.
        </p>
        <p v-if="!notice && publisher" class="adm-muted">
          The agent is
          <template v-if="ready">{{ agentLabel(ready.provider) }}</template
          ><template v-else>your writing provider’s coding tool</template>, set on the
          <a :href="ai">Scholar &amp; AI screen</a>. Each run uses Vercel Sandbox time on your Vercel account and is
          billed by {{ ready ? providerLabel(ready.provider) : 'your writing provider' }} like any use of its coding
          tool.
        </p>
        <p v-if="ready && !notice" class="adm-muted">
          Under Session, Pause keeps your unpublished changes for later and Start over throws them away.
        </p>
      </component>

      <p v-if="!status && !loadError" class="adm-muted" role="status">Loading the Site editor…</p>

      <div v-if="loadError" class="adm-banner adm-banner-error" role="alert">
        <span>The Site editor’s status couldn’t load: {{ loadError }}</span>
        <button type="button" class="adm-btn adm-btn-small" @click="load">Retry</button>
      </div>

      <!-- Setup is the publisher's job: anyone else gets one line (and Run its id for aria-describedby). -->
      <p v-if="notice && !publisher && notice.action !== 'retry'" class="adm-banner adm-editor-note">
        <span id="adm-editor-notice-title">The Site editor isn’t set up yet. Ask the site’s publisher.</span>
      </p>
      <section v-else-if="notice" class="adm-banner adm-editor-notice" aria-labelledby="adm-editor-notice-title">
        <div class="adm-editor-notice-text">
          <h2 id="adm-editor-notice-title" class="adm-h2">{{ notice.title }}</h2>
          <p id="adm-editor-notice-body">{{ notice.body }}</p>
          <template v-if="notice.steps">
            <ol class="adm-editor-steps">
              <li v-for="(step, i) in stepItems(notice.steps)" :key="i">{{ step }}</li>
            </ol>
            <p class="adm-muted">Only the person who manages the site’s hosting can do this. {{ README }}</p>
          </template>
          <details v-if="notice.body !== notice.raw">
            <summary>Technical details</summary>
            <pre class="adm-pre">{{ notice.raw }}</pre>
          </details>
        </div>
        <button v-if="notice.action === 'copy'" type="button" class="adm-btn" @click="copySteps">
          Copy setup steps
        </button>
        <a v-else-if="notice.action === 'ai'" class="adm-btn" :href="ai">Open the Scholar &amp; AI screen</a>
        <button v-else type="button" class="adm-btn" @click="load">Try again</button>
      </section>

      <div v-if="line || (ready?.published && !publishedPanel && !reviewing)" class="adm-editor-status">
        <p v-if="line" class="adm-editor-line" :class="`is-${tone}`" role="status">
          {{ line }}
        </p>
        <details v-if="failed" class="adm-editor-tech">
          <summary>Technical details</summary>
          <pre class="adm-pre">{{ failed }}</pre>
        </details>
        <div v-if="run && outcome && !busy && (outcome === 'failed' || !files.length)" class="adm-actions">
          <button
            v-if="outcome === 'failed'"
            type="button"
            class="adm-btn adm-btn-primary"
            :disabled="!!ready?.blocked"
            @click="submit(run.prompt)"
          >
            Try again
          </button>
          <button type="button" class="adm-btn" @click="editRequest">Edit request</button>
        </div>
        <div v-if="ready?.published && !publishedPanel && !reviewing" class="adm-editor-last">
          <p class="adm-muted">
            Last published
            <time :datetime="ready.published.at" :title="formatDateTime(ready.published.at)">{{
              relativeTime(ready.published.at, now)
            }}</time>
            ·
            <a v-if="ready.published.url" :href="ready.published.url" target="_blank" rel="noopener"
              >see it on GitHub<span class="adm-visually-hidden"> in a new tab</span></a
            >
            <template v-else>{{ ready.published.id.slice(0, 7) }}</template>
          </p>
          <button
            v-if="undoable && publisher"
            type="button"
            class="adm-btn adm-btn-small"
            :disabled="!!busy"
            @click="confirming = 'undo'"
          >
            Undo this publish…
          </button>
        </div>
      </div>

      <template v-if="ready">
        <section v-if="published && publishedPanel" class="adm-card adm-editor-done" aria-labelledby="adm-editor-done">
          <h2 id="adm-editor-done" ref="doneEl" class="adm-h2" tabindex="-1">Published</h2>
          <p
            class="adm-editor-line"
            :class="deploying ? 'is-working' : deployed || !published.commit ? 'is-done' : 'is-ready'"
            role="status"
          >
            {{ live }}
          </p>
          <div class="adm-actions">
            <a class="adm-btn" href="/" target="_blank" rel="noopener">
              View live site<span class="adm-visually-hidden"> in a new tab</span> <span aria-hidden="true">↗</span>
            </a>
            <button
              v-if="undoable && publisher"
              type="button"
              class="adm-btn"
              :disabled="!!busy"
              @click="confirming = 'undo'"
            >
              Undo this publish…
            </button>
            <a v-if="published.commit?.url" :href="published.commit.url" target="_blank" rel="noopener">
              See the change on GitHub ({{ published.commit.id.slice(0, 7) }})<span class="adm-visually-hidden">
                in a new tab</span
              >
            </a>
          </div>
          <p v-if="!undoable" class="adm-muted">To undo it, ask for the change back and publish again.</p>
        </section>

        <div class="adm-editor-work" :class="{ 'is-review': reviewing }">
          <div class="adm-editor-rail">
            <section v-if="reviewing" class="adm-editor-review" aria-labelledby="adm-editor-changes">
              <h2 id="adm-editor-changes" ref="reviewEl" class="adm-h2" tabindex="-1">Review the changes</h2>
              <p v-if="changedOn.every || changedOn.pages.length" class="adm-editor-pages">
                Changed on: {{ changedOn.every ? `every page${changedOn.pages.length ? ', including' : ''}` : '' }}
                <template v-for="(p, i) in changedOn.pages" :key="`${p.path} ${p.label}`">
                  <template v-if="i">, </template>
                  <a
                    :href="previewHref(p.path)"
                    :aria-current="p.path === previewPath ? 'true' : undefined"
                    @click.prevent="showPage(p.path)"
                    >{{ p.label }}</a
                  >
                </template>
              </p>
              <div v-if="ready.requests.length" class="adm-editor-group">
                <h3 class="adm-editor-h3">{{ others ? 'Asked for' : 'You asked for' }}</h3>
                <ol class="adm-editor-requests">
                  <li v-for="(r, i) in ready.requests" :key="i">
                    <p>{{ r.prompt }}</p>
                    <p v-if="r.by !== ctx.user?.login" class="adm-editor-by" dir="auto">
                      Asked by {{ r.byName || r.by }}
                    </p>
                    <p v-if="r.summary" class="adm-editor-summary">
                      <span class="adm-editor-summary-label">What changed:</span> {{ r.summary }}
                    </p>
                  </li>
                </ol>
                <details v-if="run" class="adm-editor-logbox" :open="outcome === 'failed'">
                  <summary>Agent log</summary>
                  <pre
                    ref="logEl"
                    class="adm-pre adm-editor-log"
                    tabindex="0"
                    aria-label="Agent log"
                    @scroll.passive="onLogScroll"
                    >{{ ready.log || 'No output.' }}</pre
                  >
                </details>
              </div>
              <div v-for="g in groups" :key="g.kind" class="adm-editor-group">
                <h3 class="adm-editor-h3" :class="{ 'adm-err': g.kind === 'refused' }">
                  {{ g.label }} <span class="adm-count">{{ g.files.length }}</span>
                </h3>
                <p v-if="g.kind === 'refused'" class="adm-muted">
                  The editor may not change the admin, sign-in, server code, dependencies or build settings. Undo these
                  files to publish the rest.
                </p>
                <ul class="adm-rows adm-editor-files">
                  <li v-for="f in g.files" :key="f.path">
                    <a
                      v-if="hunkIds.has(f.path)"
                      class="adm-row-main"
                      :href="`#${hunkIds.get(f.path)}`"
                      @click.prevent="jump(f.path)"
                      ><code
                        ><template v-for="(s, i) in segments(f.path)" :key="i">{{ s }}<wbr /></template></code
                      ><span class="adm-visually-hidden">, show its changes</span></a
                    >
                    <code v-else class="adm-row-main"
                      ><template v-for="(s, i) in segments(f.path)" :key="i">{{ s }}<wbr /></template
                    ></code>
                    <span class="adm-muted"
                      >{{ FILE_STATUS[f.status] }}<template v-if="f.binary"> · a file you can’t preview</template></span
                    >
                    <button
                      v-if="!f.allowed"
                      type="button"
                      class="adm-btn adm-btn-small"
                      :disabled="!!busy"
                      @click="revert(f.path)"
                    >
                      Undo this file<span class="adm-visually-hidden">: {{ f.path }}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </section>

            <component
              :is="reviewing ? 'details' : 'div'"
              v-if="!running"
              class="adm-editor-ask"
              v-bind="reviewing ? { open: askOpen } : {}"
              @toggle="onAskToggle"
            >
              <summary v-if="reviewing">Ask for another change</summary>
              <form class="adm-form" novalidate @submit.prevent="submit()">
                <div class="adm-field">
                  <label for="adm-editor-prompt">{{
                    reviewing ? 'What else should change?' : 'What should change?'
                  }}</label>
                  <textarea
                    id="adm-editor-prompt"
                    ref="promptEl"
                    v-model="prompt"
                    rows="4"
                    placeholder="Make the header serif and move the news section above publications"
                    :disabled="!!ready.blocked"
                    :aria-invalid="promptError ? 'true' : undefined"
                    :aria-describedby="promptError ? 'adm-editor-prompt-error' : undefined"
                    @input="promptError = ''"
                    @keydown="onPromptKey"
                  />
                  <p v-if="promptError" id="adm-editor-prompt-error" class="adm-err">{{ promptError }}</p>
                </div>
                <div class="adm-actions">
                  <button
                    type="submit"
                    class="adm-btn"
                    :class="{ 'adm-btn-primary': !reviewing }"
                    :disabled="!!busy || !!ready.blocked"
                    :aria-describedby="ready.blocked ? 'adm-editor-notice-title' : undefined"
                    aria-keyshortcuts="Meta+Enter Control+Enter"
                  >
                    {{ busy === 'run' ? 'Starting…' : 'Run' }}
                  </button>
                  <span class="adm-muted adm-editor-kbd" aria-hidden="true"
                    ><kbd>{{ shortcut }}</kbd></span
                  >
                </div>
              </form>
            </component>

            <section
              v-if="run && !reviewing"
              ref="runEl"
              class="adm-card adm-editor-run"
              tabindex="-1"
              aria-labelledby="adm-editor-run"
            >
              <h2 id="adm-editor-run" class="adm-h2">Your request</h2>
              <p class="adm-editor-request">{{ run.prompt }}</p>
              <p v-if="run.summary" class="adm-editor-summary">
                <span class="adm-editor-summary-label">What the agent said:</span> {{ run.summary }}
              </p>
              <div v-if="run.running" class="adm-actions">
                <button type="button" class="adm-btn" :disabled="busy === 'stop'" @click="stop">Stop</button>
                <span class="adm-editor-elapsed"
                  >Running for <span class="adm-editor-time">{{ timer }}</span></span
                >
              </div>
              <details class="adm-editor-logbox" :open="run.running || outcome === 'failed'">
                <summary>Agent log</summary>
                <pre
                  ref="logEl"
                  class="adm-pre adm-editor-log"
                  tabindex="0"
                  aria-label="Agent log"
                  @scroll.passive="onLogScroll"
                  >{{ ready.log || 'Waiting for output…' }}</pre
                >
              </details>
            </section>

            <div
              v-if="reviewing"
              class="adm-editor-bar"
              role="region"
              :aria-label="publisher ? 'Publish or discard' : 'Changes waiting for review'"
            >
              <div class="adm-editor-bar-text">
                <p id="adm-editor-bar-text">
                  {{ plural(files.length, 'file changed', 'files changed') }}
                  <template v-if="refused.length && publisher">
                    ·
                    <span class="adm-err"
                      >undo {{ plural(refused.length, 'refused file', 'refused files') }} to publish</span
                    >
                  </template>
                  <template v-if="unfinished"> · The last run didn’t finish.</template>
                </p>
                <p v-if="!publisher" class="adm-editor-bar-review">
                  Ready for review: a publisher publishes this{{
                    refused.length ? ' once the refused files are undone' : ''
                  }}.
                </p>
              </div>
              <button
                type="button"
                class="adm-btn"
                :class="{ 'adm-btn-primary': outcome === 'stopped' }"
                :disabled="!!busy"
                @click="confirming = 'discard'"
              >
                Discard…
              </button>
              <button
                v-if="publisher"
                type="button"
                class="adm-btn"
                :class="{ 'adm-btn-primary': !unfinished }"
                :disabled="!!busy || refused.length > 0 || !!ready.blocked"
                :aria-describedby="refused.length || unfinished ? 'adm-editor-bar-text' : undefined"
                @click="openPublish"
              >
                {{ busy === 'publish' ? 'Publishing…' : 'Publish…' }}
              </button>
            </div>
          </div>

          <section class="adm-editor-preview" aria-labelledby="adm-editor-preview">
            <div class="adm-head">
              <div class="adm-editor-preview-title">
                <h2 id="adm-editor-preview" class="adm-h2">Preview</h2>
                <p v-if="running" class="adm-muted">Updates when the agent finishes.</p>
              </div>
              <div class="adm-actions">
                <div class="adm-actions adm-editor-widths" role="group" aria-label="Preview width">
                  <button type="button" class="adm-btn adm-btn-small" :aria-pressed="!phone" @click="phone = false">
                    Desktop (scaled)
                  </button>
                  <button type="button" class="adm-btn adm-btn-small" :aria-pressed="phone" @click="phone = true">
                    Phone
                  </button>
                </div>
                <a :href="previewHref(previewPath)" target="_blank" rel="noopener">
                  Open preview<span class="adm-visually-hidden"> in a new tab</span> <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
            <div
              ref="viewportEl"
              class="adm-editor-viewport"
              :class="{ 'is-phone': phone && !small }"
              :style="{
                '--adm-preview-scale': scale,
                '--adm-preview-width': phone || small ? '' : `${DESKTOP_WIDTH}px`,
              }"
            >
              <div class="adm-editor-frame">
                <iframe
                  :key="previewKey"
                  :src="previewHref(previewPath)"
                  title="Preview of the edited site"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            </div>
          </section>

          <details
            v-if="reviewing"
            class="adm-editor-diffbox"
            :open="diffOpen"
            @toggle="diffOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary>
              {{ lines.length <= SMALL_DIFF ? 'Diff' : `Show the full diff (${lines.length} lines)` }}
            </summary>
            <pre class="adm-pre adm-editor-diff" tabindex="0" aria-label="Diff"><span
              v-for="(l, i) in lines"
              :id="l.file && hunkIds.get(l.file)"
              :key="i"
              :class="`is-${l.kind}`"
              :tabindex="l.file ? -1 : undefined"
            >{{ l.text || ' ' }}</span></pre>
            <p v-if="ready.diffTruncated" class="adm-muted">
              The diff is over 200 KB, so only its start is shown. The file list above is complete.
            </p>
          </details>
        </div>
      </template>
    </div>

    <div
      v-if="confirming"
      v-dialog
      class="adm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-editor-confirm"
      @keydown.esc="confirming = null"
    >
      <div>
        <form class="adm-editor-confirm" @submit.prevent="confirmed">
          <h2 id="adm-editor-confirm" class="adm-h2">{{ CONFIRM[confirming].title }}</h2>
          <p>{{ CONFIRM[confirming].text }}</p>
          <template v-if="confirming === 'publish' && ready">
            <div v-if="ready.requests.length">
              <h3 class="adm-editor-h3">{{ others ? 'Asked for' : 'You asked for' }}</h3>
              <ol class="adm-editor-requests">
                <li v-for="(r, i) in ready.requests" :key="i">
                  <p>{{ r.prompt }}</p>
                  <p v-if="r.by !== ctx.user?.login" class="adm-editor-by" dir="auto">
                    Asked by {{ r.byName || r.by }}
                  </p>
                  <p v-if="r.summary" class="adm-editor-summary">
                    <span class="adm-editor-summary-label">What changed:</span> {{ r.summary }}
                  </p>
                </li>
              </ol>
            </div>
            <div>
              <h3 class="adm-editor-h3">{{ plural(allowed.length, 'file', 'files') }}</h3>
              <ul class="adm-editor-confirm-files">
                <li v-for="f in allowed" :key="f.path">
                  <code
                    ><template v-for="(s, i) in segments(f.path)" :key="i">{{ s }}<wbr /></template
                  ></code>
                  <span class="adm-muted">{{ FILE_STATUS[f.status] }}</span>
                </li>
              </ul>
            </div>
            <p v-if="unfinished" class="adm-banner adm-editor-note">
              <span>The last run didn’t finish, so these changes may be incomplete. Check the preview first.</span>
            </p>
            <p v-if="serverCode" class="adm-banner adm-editor-note">
              <span>{{ SERVER_NOTE }}</span>
            </p>
            <a :href="previewHref(previewPath)" target="_blank" rel="noopener">
              Open preview<span class="adm-visually-hidden"> in a new tab</span> <span aria-hidden="true">↗</span>
            </a>
            <details class="adm-editor-details">
              <summary>Details</summary>
              <label class="adm-field">
                <span>Note for the change history</span>
                <input v-model="message" type="text" />
                <small>Shown in your site’s history on GitHub.</small>
              </label>
            </details>
          </template>
          <div class="adm-actions">
            <button type="button" class="adm-btn" data-autofocus @click="confirming = null">Cancel</button>
            <button
              type="submit"
              class="adm-btn"
              :class="confirming === 'publish' || confirming === 'undo' ? 'adm-btn-primary' : 'adm-btn-danger'"
            >
              {{ CONFIRM[confirming].action }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </AdminShell>
</template>
