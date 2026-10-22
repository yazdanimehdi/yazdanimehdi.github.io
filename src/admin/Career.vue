<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AdminTabLinks from './AdminTabLinks.vue';
import AdminShell from './AdminShell.vue';
import { api, report, session, toast } from './api';
import { formatDateTime, relativeTime } from './dates';
import { vDialog } from './dialog';
import { READY_STATE, digestError, runLine, visible, isRunning, type ReadyRow, type RunStatus } from './career';
import type { AdminCtx } from './types';
import type { CareerPrefs } from '../lib/career/settings';
import type { Feed, PostingSummary } from '../lib/career/types';

// Every string from a posting or a source error is third-party text: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
// The common statuses are filter tabs; the rest sit in a small select. `open` is every status not closed.
const TABS = [
  ['open', 'Open'],
  ['drafted', 'Drafted'],
  ['ready', 'Ready for approval'],
  ['submitted', 'Submitted'],
] as const;
const OTHER = [
  ['skipped', 'Skipped'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
  ['rejected', 'Rejected'],
  ['no-response', 'No response'],
  ['withdrawn', 'Withdrawn'],
  ['all', 'All'],
] as const;
const KNOWN = new Set<string>([...TABS, ...OTHER].map(([s]) => s));
const fromUrl = () => {
  const s = new URLSearchParams(location.search).get('status') ?? '';
  return KNOWN.has(s) ? s : 'open';
};

const empty = { rows: [], total: 0 };
const groups = ref<Feed>({ matches: empty, below: empty, gated: empty, unscored: empty });
const threshold = ref(70);
const filter = ref(fromUrl());
const run = ref<RunStatus>({ runId: null, status: null, lastRun: null });
const loading = ref(true);
const starting = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

const running = computed(() => starting.value || isRunning(run.value.status));

const readyRows = ref<ReadyRow[]>([]);
async function loadRows() {
  const status = filter.value;
  try {
    if (status === 'ready') {
      const { rows } = await api<{ rows: ReadyRow[] }>('career/ready');
      if (status !== filter.value) return; // a later filter's answer wins
      readyRows.value = rows;
      session.careerReady = rows.filter((r) => r.state === 'ready').length;
      return;
    }
    const feed = await api<Feed>(`career/postings${status === 'all' ? '' : `?status=${status}`}`);
    if (status !== filter.value) return;
    groups.value = feed;
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
}

/** The ready postings that are waiting for approval, the ones Approve all ready approves. */
function waiting() {
  return readyRows.value.filter((r) => r.state === 'ready');
}
const confirmAll = ref(false);
const approving = ref(false);
/** Approves exactly the rows the dialog listed, each by the pre-fill it showed: one re-filled since is left alone. */
async function approveAll() {
  confirmAll.value = false;
  approving.value = true;
  const items = waiting().map((r) => ({ id: r.id, at: r.prefilledAt }));
  try {
    const { approved, skipped, queued } = await api<{
      approved: number[];
      skipped: { id: number; reason: string }[];
      queued: boolean;
    }>('career/approve-all', { body: { items } });
    const sent = !approved.length
      ? 'Nothing was approved'
      : queued
        ? `Approved ${approved.length}: each is submitted in the next few minutes`
        : `Approved ${approved.length}: they are submitted when the queue next runs (at the latest with tonight’s run)`;
    const again = skipped.filter((s) => s.reason === 'pre-filled again').length;
    const gone = skipped.length - again;
    const left = [again && `${again} pre-filled again since you looked`, gone && `${gone} no longer waiting`]
      .filter(Boolean)
      .join(', ');
    toast(left ? `${sent}. ${left}: left as they were.` : `${sent}.`);
  } catch (e) {
    report(e);
  } finally {
    approving.value = false;
    await loadRows();
  }
}

/** A history entry per filter, so Back and reload come back to it. */
function setFilter(status: string) {
  if (status === filter.value) return;
  filter.value = status;
  history.pushState(null, '', status === 'open' ? location.pathname : `?status=${status}`);
  void loadRows();
}
function onPop() {
  filter.value = fromUrl();
  void loadRows();
}

async function poll() {
  try {
    run.value = await api<RunStatus>('career/run');
  } catch (e) {
    stop();
    return report(e);
  }
  if (!isRunning(run.value.status)) {
    stop();
    await loadRows();
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
    const res = await api<{ runId?: string; running?: boolean }>('career/run', { method: 'POST' });
    if (res.running) toast('A run is already in progress');
    run.value = { ...run.value, status: 'running' };
    watch();
  } catch (e) {
    report(e);
  } finally {
    starting.value = false;
  }
}

const where = (r: PostingSummary) => [r.location, r.remote ? 'remote' : ''].filter(Boolean).join(' · ');

// The run status is unknown until `career/run` answers; until then the strip shows a placeholder, not "No run yet".
const runKnown = ref(false);
onMounted(async () => {
  addEventListener('popstate', onPop);
  void loadRows();
  const [s, r] = await Promise.allSettled([
    api<{ prefs: CareerPrefs }>('career/settings'),
    api<RunStatus>('career/run'),
  ]);
  if (s.status === 'fulfilled') threshold.value = s.value.prefs.threshold;
  else report(s.reason);
  runKnown.value = true; // on a failure too: "No run yet" and Run now, rather than a placeholder forever
  if (r.status === 'fulfilled') {
    run.value = r.value;
    if (isRunning(run.value.status)) watch();
  } else report(r.reason);
});
onBeforeUnmount(() => {
  stop();
  removeEventListener('popstate', onPop);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="career" title="Job search">
    <AdminTabLinks
      label="Job search"
      :tabs="[
        { href: `${base}/career`, label: 'Postings', current: filter !== 'ready' },
        {
          href: `${base}/career?status=ready`,
          label: 'Ready for approval',
          current: filter === 'ready',
          count: session.careerReady ?? undefined,
        },
        { href: `${base}/career/settings`, label: 'Settings' },
      ]"
    />
    <div v-if="!runKnown" class="adm-verdict" aria-hidden="true"><span class="adm-skel-bar" /></div>
    <div v-else class="adm-verdict adm-run" :class="{ 'is-attention': run.status === 'failed' }">
      <p role="status">
        <template v-if="run.status === 'failed'">The last run failed. </template>
        <template v-if="run.lastRun">
          {{ run.status === 'failed' ? 'Last finished run' : 'Last run' }} {{ relativeTime(run.lastRun.at) }} ·
          {{ runLine(run.lastRun) }}
        </template>
        <template v-else-if="run.status !== 'failed'">No run yet. The search runs every night.</template>
      </p>
      <button type="button" class="adm-btn adm-btn-primary" :disabled="running" @click="runNow">
        {{ running ? 'Running…' : 'Run now' }}
      </button>
    </div>
    <template v-if="run.lastRun">
      <p v-if="run.lastRun.stopped" class="adm-err" role="status">Stopped early: {{ visible(run.lastRun.stopped) }}</p>
      <p v-if="digestError(run.lastRun)" class="adm-err" role="status">
        The digest email wasn’t sent: {{ visible(digestError(run.lastRun)!) }}
      </p>
      <p v-if="run.lastRun.scoreSkipped" class="adm-err" role="status">
        Nothing was scored: {{ visible(run.lastRun.scoreSkipped) }}
      </p>
      <p v-if="run.lastRun.scoreError" class="adm-err" role="status">
        Scoring hit an error: {{ visible(run.lastRun.scoreError) }}. Those postings wait for the next run.
      </p>
      <details v-if="run.lastRun.sources.length" class="adm-nav-more" :open="run.lastRun.sources.some((s) => s.error)">
        <summary>By source ({{ run.lastRun.sources.length }})</summary>
        <ul class="adm-rows">
          <li v-for="s in run.lastRun.sources" :key="s.id">
            <span class="adm-row-label">{{ s.id }}</span>
            <span class="adm-row-main">
              found {{ s.found }} · added {{ s.added }}
              <span v-if="s.skipped" class="adm-row-detail">Skipped: {{ visible(s.skipped) }}</span>
              <span v-if="s.error" class="adm-row-detail adm-err">{{ visible(s.error) }}</span>
            </span>
          </li>
        </ul>
      </details>
    </template>

    <div class="adm-filter-row">
      <div class="adm-filter" role="group" aria-label="Status">
        <button v-for="[s, label] in TABS" :key="s" type="button" :aria-pressed="filter === s" @click="setFilter(s)">
          {{ label }}
        </button>
      </div>
      <select
        aria-label="Other status"
        :value="OTHER.some(([s]) => s === filter) ? filter : ''"
        @change="setFilter(($event.target as HTMLSelectElement).value || 'open')"
      >
        <option value="">Other status</option>
        <option v-for="[s, label] in OTHER" :key="s" :value="s">{{ label }}</option>
      </select>
    </div>

    <p v-if="loading" class="adm-muted">Loading…</p>
    <template v-else-if="filter === 'ready'">
      <div class="adm-ready-head">
        <p class="adm-muted">
          Nothing is sent until you approve. Approving submits an application with the values on its page, usually
          within a few minutes.
        </p>
        <button
          type="button"
          class="adm-btn adm-btn-primary"
          :disabled="!waiting().length || approving"
          @click="confirmAll = true"
        >
          {{ approving ? 'Approving…' : 'Approve all ready' }}
        </button>
      </div>
      <p v-if="!readyRows.length" class="adm-muted">
        Nothing is waiting for approval. A pre-filled application shows here until you approve, skip or finish it.
      </p>
      <ul v-else class="adm-rows">
        <li v-for="r in readyRows" :key="r.id">
          <strong class="adm-row-label" :aria-label="r.score === null ? 'Not scored' : `Score ${r.score}`">{{
            r.score ?? '–'
          }}</strong>
          <span class="adm-row-main">
            {{ r.title }}
            <span class="adm-row-detail"
              >{{ r.company }}<template v-if="r.fields"> · {{ r.fields }} fields</template
              ><template v-if="r.state !== 'ready'"> · {{ READY_STATE[r.state ?? 'none'] }}</template></span
            >
          </span>
          <span class="adm-row-date"
            ><template v-if="r.prefilledAt"
              >Pre-filled <time :datetime="r.prefilledAt">{{ formatDateTime(r.prefilledAt) }}</time></template
            ></span
          >
          <span class="adm-row-action"
            ><a :href="`${base}/career/${r.id}#job-apply`" :aria-label="`Review ${r.title} at ${r.company}`"
              >Review <span aria-hidden="true">→</span></a
            ></span
          >
        </li>
      </ul>
    </template>
    <template v-else>
      <h2 class="adm-h2">Matches ({{ groups.matches.total }})</h2>
      <p v-if="!groups.matches.total" class="adm-muted">Nothing at or above {{ threshold }} yet.</p>
      <ul v-else class="adm-rows">
        <li v-for="r in groups.matches.rows" :key="r.id">
          <strong class="adm-row-label" :aria-label="`Score ${r.score}`">{{ r.score }}</strong>
          <span class="adm-row-main">
            <a :href="`${base}/career/${r.id}`">{{ r.title }}</a>
            <span class="adm-row-detail"
              >{{ r.company }}<template v-if="where(r)"> · {{ where(r) }}</template></span
            >
          </span>
          <span v-if="r.flagged" title="The ad contained hidden or instruction-like text" aria-label="Flagged">⚠</span>
          <span class="adm-row-date">{{ r.status }}</span>
        </li>
      </ul>
      <p v-if="groups.matches.total > groups.matches.rows.length" class="adm-muted">
        Showing the best {{ groups.matches.rows.length }}.
      </p>

      <details
        v-for="[label, list, gate] in [
          ['Below threshold', groups.below, false],
          ['Filtered out', groups.gated, true],
          ['Not scored yet', groups.unscored, false],
        ] as const"
        :key="label"
        class="adm-nav-more"
      >
        <summary>{{ label }} ({{ list.total }})</summary>
        <ul class="adm-rows">
          <li v-for="r in list.rows" :key="r.id">
            <strong v-if="r.score !== null" class="adm-row-label">{{ r.score }}</strong>
            <span class="adm-row-main">
              <a :href="`${base}/career/${r.id}`">{{ r.title }}</a>
              <span class="adm-row-detail">
                {{ r.company }}<template v-if="where(r)"> · {{ where(r) }}</template>
                <template v-if="gate && r.gate"> · {{ visible(r.gate) }}</template>
              </span>
            </span>
            <span v-if="r.flagged" title="The ad contained hidden or instruction-like text" aria-label="Flagged"
              >⚠</span
            >
            <span class="adm-row-date">{{ r.status }}</span>
          </li>
        </ul>
        <p v-if="list.total > list.rows.length" class="adm-muted">Showing the first {{ list.rows.length }}.</p>
      </details>
    </template>

    <div
      v-if="confirmAll"
      v-dialog
      class="adm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-approve-all"
      @keydown.esc="confirmAll = false"
    >
      <div>
        <h2 id="adm-approve-all" class="adm-h2">
          Approve {{ waiting().length === 1 ? 'this application' : `these ${waiting().length} applications` }}?
        </h2>
        <p>
          Each one is approved on its own, with the values it was pre-filled with, and submitted within a few minutes.
          Any form that changed since is stopped and handed back to you.
        </p>
        <ul class="adm-rows">
          <li v-for="r in waiting()" :key="r.id">
            <span class="adm-row-main"
              >{{ r.title }}<span class="adm-row-detail">{{ r.company }} · {{ r.fields }} fields</span></span
            >
          </li>
        </ul>
        <div class="adm-actions">
          <button type="button" class="adm-btn" data-autofocus @click="confirmAll = false">Cancel</button>
          <button type="button" class="adm-btn adm-btn-primary" @click="approveAll">Approve and submit all</button>
        </div>
      </div>
    </div>
  </AdminShell>
</template>
