<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, committed, toast, toastError } from './api';
import { formatDate, formatDateTime, relativeTime } from './dates';
import {
  nextUp,
  plainFailure,
  siteStatus,
  statusSummary,
  STATUS_CHIP,
  type DashboardData,
  type NewsDraft,
  type RunKind,
  type RunName,
  type StatusRow,
} from './status';
import { storedDrafts } from './useDocument';
import type { AdminCtx } from './types';
import type { JobsRecord } from '../lib/admin/jobs';
import type { PapersResult } from '../lib/admin/papers';

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const NEXT_UP_LIMIT = 5;
const MARKER = { nudge: 'Suggested', unseen: 'No access', unknown: 'Not run yet', off: 'Off' } as const;
/** What an in-place action changes, read under the row; it follows the button's own label ("Check now imports…"). */
const CHANGES: Partial<Record<RunKind, string>> = {
  'sync-papers': 'imports new papers from Google Scholar and drafts a post for each; your live site updates.',
  'sync-feeds': 'fetches every feed and adds its new posts to the blog; your live site updates.',
};
/** git mode: how often, and how many times, to look for a workflow run started from here (about 10 minutes). */
const WATCH_MS = 15_000;
const WATCH_TRIES = 40;
/** The header button's key in `busy`; rows use their own key. */
const JOBS = 'jobs';
/** Placeholder rows while loading: about as many as a real site has, so the page doesn't jump. */
const SKELETON_ROWS = 7;

const d = ref<DashboardData | null>(null);
const loadError = ref('');
/** The control whose action is running: a row key, or JOBS. One at a time; the others are disabled meanwhile. */
const busy = ref<string | null>(null);
/** Read out after an in-place action refreshes the rows; empty otherwise, so loading the page stays quiet. */
const announcement = ref('');
/** git mode: a row whose workflow was just started on GitHub, and its latest run's time before that. */
const watching = ref<{ key: RunName; before?: string } | null>(null);
let alive = true;
let poll: ReturnType<typeof setTimeout> | undefined;

/** Has the watched row's new run shown up on GitHub yet? */
const isNewRun = (at: string | undefined, before?: string) => !!at && (!before || Date.parse(at) > Date.parse(before));

const rows = computed(() => {
  if (!d.value) return [];
  const all = siteStatus(d.value);
  const w = watching.value;
  if (!w || isNewRun(d.value.runs[w.key]?.at, w.before)) return all;
  // GitHub lists a dispatched run only after a few seconds: until then the row says it is starting, in place.
  return all.map(
    (r): StatusRow =>
      r.key === w.key
        ? {
            ...r,
            state: 'Starting on GitHub…',
            tone: 'ok',
            at: null,
            detail: undefined,
            raw: undefined,
            link: undefined,
          }
        : r,
  );
});
const verdict = computed(() => statusSummary(rows.value));
/** Nothing needs fixing: what to write next leads, and the status follows. */
const sections = computed(() => (verdict.value.tone === 'attention' ? ['status', 'next'] : ['next', 'status']));
const newsDrafts = ref<NewsDraft[]>([]);
const upcoming = computed(() => (d.value ? nextUp(d.value.posts, newsDrafts.value) : []));
const names = new Intl.ListFormat('en', { type: 'conjunction' });
/** Front-matter dates are calendar days; job times have a clock time worth showing. */
const absolute = (t: string) => (/^\d{4}-\d{2}-\d{2}$/.test(t) ? formatDate(t) : formatDateTime(t));

function readNewsDrafts() {
  newsDrafts.value = storedDrafts('announcements/').flatMap(({ key, value }) => {
    const data = (value as { data?: Record<string, unknown> } | null)?.data;
    if (!data) return [];
    const slug = key.slice('announcements/'.length);
    return [{ slug: slug === 'new' ? null : slug, data }];
  });
}

async function load() {
  loadError.value = '';
  try {
    d.value = await api<DashboardData>('dashboard');
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

/** A failure toast in plain words; the service's own words go to the console, as the rows keep them in a disclosure. */
function toastFailure(raw: string, service: string, unknown = raw) {
  const plain = plainFailure(raw, service);
  // eslint-disable-next-line no-console
  if (plain) console.warn('[dashboard]', raw);
  toastError(plain ?? unknown);
}

async function syncFeeds() {
  const result = await api<{
    changed: boolean;
    count: number;
    failed: { source: string; error: string }[];
    url?: string;
  }>('feeds/sync', { method: 'POST' });
  if (result.changed) committed(result);
  else toast(`No new posts in any feed (${result.count} in total)`);
  for (const f of result.failed) toastFailure(f.error, `The feed “${f.source}”`, `Feed “${f.source}”: ${f.error}`);
}

async function runJobs() {
  const jobs = await api<JobsRecord>('jobs/run', { method: 'POST' });
  const failed = Object.values(jobs).filter((j) => j?.ok === false).length;
  if (failed) toastError(`Daily jobs finished; ${failed} failed. See Site status.`);
  else toast('Daily jobs finished');
}

async function syncPapers() {
  const r = await api<PapersResult>('papers/sync', { method: 'POST' });
  const text = `Google Scholar checked: ${r.imported.length} new publications, ${r.posts.length} draft posts`;
  if (r.skipped) toast(`Nothing checked: ${r.skipped}`);
  // New drafts wait for review, so the notice stays until it is used or dismissed.
  else if (r.posts.length) {
    const label = `Review ${r.posts.length} new draft${r.posts.length === 1 ? '' : 's'}`;
    toast(text, undefined, { label, run: () => location.assign(`${base}/posts`) });
  } else toast(text);
}

async function renderCv() {
  const before = d.value?.runs.cv?.at;
  const r = await api<{ dispatched?: boolean; warning?: 'cache-purge-failed'; tags?: string[] }>('cv/pdf', {
    method: 'POST',
  });
  if (r.warning) committed(r);
  else toast(r.dispatched ? 'PDF build started on GitHub; it takes a few minutes' : 'PDF updated');
  if (r.dispatched) void watchRun('cv', before);
}

/**
 * git mode: after starting a workflow, polls the dashboard until the row's new run has finished, then announces how it
 * went. Gives up quietly after WATCH_TRIES; the row then shows whatever GitHub last said.
 */
async function watchRun(key: RunName, before?: string) {
  watching.value = { key, before };
  for (let i = 0; i < WATCH_TRIES && alive; i++) {
    await new Promise((done) => (poll = setTimeout(done, WATCH_MS)));
    const next = await api<DashboardData>('dashboard').catch(() => null);
    if (!alive || !next) continue;
    const focused = document.activeElement;
    d.value = next;
    await nextTick();
    // A row that changes tone moves; keep focus where it was.
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus();
    const run = next.runs[key];
    if (next.hiddenRuns[key]) break;
    if (run && run.ok !== null && isNewRun(run.at, before)) {
      const row = rows.value.find((r) => r.key === key);
      if (row) announcement.value = `${row.label} finished on GitHub: ${row.state}.`;
      break;
    }
  }
  watching.value = null;
}

const RUNNERS: Record<RunKind, [() => Promise<void>, string]> = {
  'sync-feeds': [syncFeeds, 'A feed'],
  'run-jobs': [runJobs, 'The daily jobs'],
  'sync-papers': [syncPapers, 'Google Scholar'],
  'render-cv': [renderCv, 'The PDF builder'],
};

const isRun = (kind: string): kind is RunKind => kind in RUNNERS;

/** After the rows re-sort, focus goes back to the same row: its action, or the row itself when the action is gone. */
function refocus(control: string) {
  if (control === JOBS) return document.getElementById('adm-run-jobs')?.focus();
  const row = document.getElementById(`row-${control}`);
  (row?.querySelector<HTMLElement>('.adm-row-action :is(a, button)') ?? row)?.focus();
}

async function run(kind: RunKind, control: string) {
  // the running (or watched) button stays focusable (aria-disabled), so it guards itself
  if (busy.value || watching.value?.key === control) return;
  const [action, service] = RUNNERS[kind];
  busy.value = control;
  announcement.value = '';
  try {
    await action();
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    toastFailure(raw, service);
  } finally {
    await load(); // last sync, job results and post statuses changed
    busy.value = null;
    await nextTick();
    refocus(control);
    // A run started on GitHub is announced when it finishes (watchRun); the toast already said it started.
    if (d.value && watching.value?.key !== control) announcement.value = `Site status updated: ${verdict.value.text}.`;
  }
}

onMounted(() => {
  readNewsDrafts();
  void load();
});
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(poll);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="" title="Dashboard" narrow>
    <template #actions>
      <a class="adm-btn" :href="`${base}/content/announcements?new`">New news item</a>
      <!-- While something is broken, the fix is the page's main action, not a new post. -->
      <a class="adm-btn" :class="{ 'adm-btn-primary': verdict.tone !== 'attention' }" :href="`${base}/posts/new`"
        >New blog post</a
      >
    </template>

    <p v-if="d && !loadError" class="adm-verdict" :class="`is-${verdict.tone}`">
      <a v-if="verdict.key" :href="`#row-${verdict.key}`">{{ verdict.lead }}</a>
      <template v-else>{{ verdict.lead }}</template>
      <template v-if="verdict.suggestions">
        · <a :href="`#row-${verdict.suggestions.key}`">{{ verdict.suggestions.text }}</a>
      </template>
    </p>
    <p class="adm-visually-hidden" role="status">{{ announcement }}</p>

    <div v-if="loadError" class="adm-banner adm-banner-error" role="alert">
      <span
        >The dashboard could not load ({{ loadError }}). The rest of the admin still works: pick a screen from the
        menu.</span
      >
      <button type="button" class="adm-btn" @click="load">Retry</button>
    </div>
    <div v-else-if="!d" class="adm-skeleton" role="status">
      <span class="adm-visually-hidden">Loading the dashboard…</span>
      <div class="adm-verdict" aria-hidden="true"><span class="adm-skel-bar" /></div>
      <div class="adm-form" aria-hidden="true">
        <div class="adm-head"><span class="adm-h2">Site status</span></div>
        <ul class="adm-rows adm-status-rows">
          <li v-for="i in SKELETON_ROWS" :key="i">
            <span class="adm-row-label"><span class="adm-skel-bar" /></span>
            <span class="adm-row-main"><span class="adm-skel-bar" /><span class="adm-skel-bar is-short" /></span>
          </li>
        </ul>
      </div>
    </div>

    <template v-else>
      <template v-for="section in sections" :key="section">
        <section v-if="section === 'status'" class="adm-form" aria-labelledby="adm-status">
          <div class="adm-head">
            <h2 id="adm-status" class="adm-h2">Site status</h2>
            <button
              v-if="d.mode === 'postgres'"
              id="adm-run-jobs"
              type="button"
              class="adm-btn"
              aria-describedby="adm-jobs-desc"
              :disabled="busy !== null && busy !== JOBS"
              :aria-disabled="busy === JOBS || undefined"
              :aria-busy="busy === JOBS"
              @click="run('run-jobs', JOBS)"
            >
              {{ busy === JOBS ? 'Running…' : 'Run daily jobs' }}
            </button>
          </div>
          <p v-if="d.mode === 'postgres'" id="adm-jobs-desc" class="adm-muted adm-jobs-desc">
            Releases scheduled posts that are due, syncs feeds, checks Google Scholar and backs up to GitHub. They also
            run on their own once a day.
          </p>
          <ul class="adm-rows adm-status-rows">
            <li v-for="r in rows" :id="`row-${r.key}`" :key="r.key" :class="`is-${r.tone}`" tabindex="-1">
              <h3 class="adm-row-label">{{ r.label }}</h3>
              <span class="adm-row-main">
                <span v-if="r.tone in MARKER" class="adm-status adm-status-tone">{{
                  MARKER[r.tone as keyof typeof MARKER]
                }}</span>
                <span class="adm-row-state">{{ r.state }}</span>
                <template v-if="r.at">
                  · <time :datetime="r.at">{{ relativeTime(r.at) }}</time>
                  <span class="adm-row-abs"> ({{ absolute(r.at) }})</span>
                </template>
                <span v-if="r.detail" class="adm-row-detail">{{ r.detail }}</span>
                <details v-if="r.raw" class="adm-row-raw">
                  <summary>
                    Technical detail<span class="adm-visually-hidden">: {{ r.label }}</span>
                  </summary>
                  <code>{{ r.raw }}</code>
                </details>
                <span v-if="r.action && r.action.kind in CHANGES" :id="`changes-${r.key}`" class="adm-row-detail"
                  >{{ r.action.label }} {{ CHANGES[r.action.kind as RunKind] }}</span
                >
                <a
                  v-if="r.link"
                  class="adm-row-link"
                  :href="r.link.url"
                  target="_blank"
                  rel="noopener"
                  :aria-label="`${r.link.label}: ${r.label} (opens in a new tab)`"
                  >{{ r.link.label }} <span aria-hidden="true">↗</span></a
                >
              </span>
              <span class="adm-row-action">
                <a
                  v-if="r.action?.kind === 'screen'"
                  :href="`${base}/${r.action.path}`"
                  :aria-label="`${r.action.label}: ${r.label}`"
                  >{{ r.action.label }} <span aria-hidden="true">→</span></a
                >
                <a
                  v-else-if="r.action?.kind === 'external'"
                  :href="r.action.url"
                  :aria-label="`${r.action.label}: ${r.label} (opens in a new tab)`"
                  target="_blank"
                  rel="noopener"
                  >{{ r.action.label }} <span aria-hidden="true">↗</span></a
                >
                <button
                  v-else-if="r.action && isRun(r.action.kind)"
                  type="button"
                  class="adm-btn adm-btn-small"
                  :disabled="busy !== null && busy !== r.key"
                  :aria-disabled="busy === r.key || watching?.key === r.key || undefined"
                  :aria-busy="busy === r.key || watching?.key === r.key"
                  :aria-label="`${r.action.label}: ${r.label}`"
                  :aria-describedby="r.action.kind in CHANGES ? `changes-${r.key}` : undefined"
                  @click="run(r.action.kind, r.key)"
                >
                  {{ busy === r.key || watching?.key === r.key ? 'Working…' : r.action.label }}
                </button>
              </span>
            </li>
          </ul>
        </section>

        <section v-else class="adm-form" aria-labelledby="adm-next">
          <div class="adm-head">
            <h2 id="adm-next" class="adm-h2">Next up</h2>
            <a :href="`${base}/posts`">All posts <span aria-hidden="true">→</span></a>
          </div>
          <ul v-if="d.review.length || upcoming.length" class="adm-rows">
            <li v-if="d.review.length">
              <span class="adm-row-title">
                <a :href="`${base}/editor`">Site changes waiting for review</a> · asked by
                <span dir="auto">{{ names.format(d.review) }}</span>
              </span>
            </li>
            <li v-for="p in upcoming.slice(0, NEXT_UP_LIMIT)" :key="p.key">
              <span class="adm-row-title">
                <a dir="auto" :href="`${base}/${p.path}`">{{ p.title }}</a>
                <span v-if="p.author" class="adm-row-detail" dir="auto">By {{ p.author }}</span>
              </span>
              <span class="adm-status" :class="STATUS_CHIP[p.status]">{{ p.status }}</span>
              <time v-if="p.date" class="adm-row-date" :datetime="p.date">{{ formatDate(p.date) }}</time>
            </li>
          </ul>
          <p v-else class="adm-muted adm-next-note">
            No drafts or scheduled posts. News drafts are saved in this browser only, and there are none here.
            <a :href="`${base}/posts/new`">Start a blog post</a>.
          </p>
          <p v-if="upcoming.length > NEXT_UP_LIMIT" class="adm-muted adm-next-note">
            {{ upcoming.length - NEXT_UP_LIMIT }} more on the <a :href="`${base}/posts`">Blog posts</a> screen.
          </p>
        </section>
      </template>
    </template>
  </AdminShell>
</template>
