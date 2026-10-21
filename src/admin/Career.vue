<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, report, toast } from './api';
import { groupFeed, visible, isRunning, type RunStatus } from './career';
import type { AdminCtx } from './types';
import type { CareerPrefs } from '../lib/career/settings';
import type { PostingStatus, PostingSummary } from '../lib/career/types';

// Every string from a posting or a source error is third-party text: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const STATUSES: PostingStatus[] = [
  'found',
  'skipped',
  'drafted',
  'ready',
  'submitted',
  'interview',
  'offer',
  'rejected',
  'no-response',
  'withdrawn',
];

const rows = ref<PostingSummary[]>([]);
const threshold = ref(70);
const filter = ref('');
const run = ref<RunStatus>({ runId: null, status: null, lastRun: null });
const loading = ref(true);
const starting = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

const groups = computed(() => groupFeed(rows.value, threshold.value));
const running = computed(() => starting.value || isRunning(run.value.status));

async function loadRows() {
  try {
    rows.value = await api<PostingSummary[]>(`career/postings${filter.value ? `?status=${filter.value}` : ''}`);
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
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

const when = (iso: string) => new Date(iso).toLocaleString();
const where = (r: PostingSummary) => [r.location, r.remote ? 'remote' : ''].filter(Boolean).join(' · ');

onMounted(async () => {
  try {
    const s = await api<{ prefs: CareerPrefs }>('career/settings');
    threshold.value = s.prefs.threshold;
    run.value = await api<RunStatus>('career/run');
  } catch (e) {
    report(e);
  }
  await loadRows();
  if (isRunning(run.value.status)) watch();
});
onBeforeUnmount(stop);
</script>

<template>
  <AdminShell :ctx="ctx" active="career" title="Job search">
    <section class="adm-card" aria-labelledby="career-run">
      <h2 id="career-run" class="adm-h2">Last run</h2>
      <template v-if="run.lastRun">
        <p class="adm-muted">
          {{ when(run.lastRun.at) }} · scored {{ run.lastRun.scored }}
          <template v-if="run.lastRun.deferred"> · {{ run.lastRun.deferred }} left for later</template>
          <template v-if="run.lastRun.failed"> · {{ run.lastRun.failed }} failed to score</template>
        </p>
        <p v-if="run.lastRun.scoreSkipped" class="adm-err" role="status">
          Nothing was scored: {{ run.lastRun.scoreSkipped }}
        </p>
        <ul class="adm-rows">
          <li v-for="s in run.lastRun.sources" :key="s.id">
            <span class="adm-row-label">{{ s.id }}</span>
            <span class="adm-row-main">
              found {{ s.found }} · added {{ s.added }}
              <span v-if="s.skipped" class="adm-row-detail">Skipped: {{ s.skipped }}</span>
              <span v-if="s.error" class="adm-row-detail adm-err">{{ s.error }}</span>
            </span>
          </li>
        </ul>
      </template>
      <p v-else class="adm-muted">No run yet. The search runs every night, or now:</p>
      <div class="adm-actions">
        <button type="button" class="adm-btn adm-btn-primary" :disabled="running" @click="runNow">
          {{ running ? 'Running…' : 'Run now' }}
        </button>
        <a class="adm-btn" :href="`${base}/career/settings`">Settings</a>
      </div>
    </section>

    <div class="adm-form">
      <label class="adm-field">
        <span>Status</span>
        <select v-model="filter" @change="loadRows">
          <option value="">All</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
    </div>

    <p v-if="loading" class="adm-muted">Loading…</p>
    <template v-else>
      <h2 class="adm-h2">Matches ({{ groups.matches.length }})</h2>
      <p v-if="!groups.matches.length" class="adm-muted">Nothing at or above {{ threshold }} yet.</p>
      <ul v-else class="adm-rows">
        <li v-for="r in groups.matches" :key="r.id">
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

      <details
        v-for="[label, list, gate] in [
          ['Below threshold', groups.below, false],
          ['Filtered out', groups.gated, true],
          ['Not scored yet', groups.unscored, false],
        ] as const"
        :key="label"
        class="adm-nav-more"
      >
        <summary>{{ label }} ({{ list.length }})</summary>
        <ul class="adm-rows">
          <li v-for="r in list" :key="r.id">
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
      </details>
    </template>
  </AdminShell>
</template>
