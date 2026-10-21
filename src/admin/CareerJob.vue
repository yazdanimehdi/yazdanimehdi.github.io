<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, report } from './api';
import { httpUrl } from './career';
import { PostingText } from './PostingText';
import type { AdminCtx } from './types';
import type { ScoreDetail } from '../lib/career/score';
import type { Posting, PostingStatus } from '../lib/career/types';

// Every string from the posting is third-party text: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx; id: string }>();
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
const DIMENSIONS = ['technical', 'experience', 'culture', 'career'] as const;
const VERDICTS = ['location', 'language', 'eligibility'] as const;

interface JobEvent {
  at: string;
  kind: string;
  detail: string | null;
}

const posting = ref<Posting | null>(null);
const events = ref<JobEvent[]>([]);
const notes = ref('');
const loading = ref(true);
const missing = ref(false);

const detail = computed(() => posting.value?.scoreDetail as ScoreDetail | null);
const link = computed(() => httpUrl(posting.value?.url));
const applyLink = computed(() => httpUrl(posting.value?.applyUrl));
const when = (iso: string) => new Date(iso).toLocaleString();

function take(res: { posting: Posting; events: JobEvent[] }) {
  posting.value = res.posting;
  events.value = res.events;
  notes.value = res.posting.notes;
}

async function patch(body: { status?: PostingStatus; notes?: string }) {
  try {
    take(await api(`career/postings/${props.id}`, { method: 'PATCH', body }));
  } catch (e) {
    report(e);
  }
}

onMounted(async () => {
  try {
    take(await api(`career/postings/${props.id}`));
  } catch (e) {
    missing.value = true;
    report(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="career" :title="posting ? posting.title : 'Job'">
    <p><a :href="`${base}/career`">← All postings</a></p>
    <p v-if="loading" class="adm-muted">Loading…</p>
    <p v-else-if="missing || !posting" class="adm-muted">This posting could not be loaded.</p>
    <template v-else>
      <p class="adm-muted">
        {{ posting.company }}<template v-if="posting.location"> · {{ posting.location }}</template
        ><template v-if="posting.remote"> · remote</template> · found {{ when(posting.foundAt) }}
      </p>

      <section class="adm-card" aria-labelledby="job-fit">
        <h2 id="job-fit" class="adm-h2">Fit</h2>
        <p v-if="posting.gate" class="adm-err">Filtered out: {{ posting.gate }}</p>
        <p v-if="posting.scoreError" class="adm-err">Scoring failed: {{ posting.scoreError }}</p>
        <p v-if="posting.score === null && !posting.gate && !posting.scoreError" class="adm-muted">Not scored yet.</p>
        <template v-if="posting.score !== null && detail">
          <p>
            <strong>{{ posting.score }}</strong> / 100
          </p>
          <ul class="adm-rows">
            <li v-for="d in DIMENSIONS" :key="d">
              <span class="adm-row-label">{{ d }}</span>
              <meter class="adm-job-bar" min="0" max="100" :value="detail[d]" :aria-label="`${d} ${detail[d]}`" />
              <span class="adm-row-date">{{ detail[d] }}</span>
            </li>
          </ul>
          <p class="adm-muted">
            <template v-for="v in VERDICTS" :key="v">{{ v }}: {{ detail[v] }} · </template>
          </p>
          <template v-if="detail.strengths.length">
            <h3>Strengths</h3>
            <ul>
              <li v-for="s in detail.strengths" :key="s">{{ s }}</li>
            </ul>
          </template>
          <template v-if="detail.gaps.length">
            <h3>Gaps</h3>
            <ul>
              <li v-for="g in detail.gaps" :key="g">{{ g }}</li>
            </ul>
          </template>
          <p v-if="detail.notes" class="adm-muted">{{ detail.notes }}</p>
        </template>
      </section>

      <section class="adm-card" aria-labelledby="job-status">
        <h2 id="job-status" class="adm-h2">Status</h2>
        <label class="adm-field">
          <span>Status</span>
          <select
            :value="posting.status"
            @change="patch({ status: ($event.target as HTMLSelectElement).value as PostingStatus })"
          >
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="adm-field">
          <span>Notes</span>
          <textarea v-model="notes" rows="4" maxlength="20000" @blur="notes !== posting.notes && patch({ notes })" />
        </label>
      </section>

      <section class="adm-card" aria-labelledby="job-posting">
        <h2 id="job-posting" class="adm-h2">Posting</h2>
        <p class="adm-actions">
          <a v-if="link" class="adm-btn" :href="link" target="_blank" rel="noopener noreferrer nofollow"
            >Original posting</a
          >
          <a v-if="applyLink" class="adm-btn" :href="applyLink" target="_blank" rel="noopener noreferrer nofollow"
            >Apply</a
          >
        </p>
        <PostingText :text="posting.description" :flags="posting.flags" />
      </section>

      <section class="adm-card" aria-labelledby="job-history">
        <h2 id="job-history" class="adm-h2">History</h2>
        <p v-if="!events.length" class="adm-muted">No changes yet.</p>
        <ul v-else class="adm-rows">
          <li v-for="(e, i) in events" :key="i">
            <span class="adm-row-label">{{ e.kind }}</span>
            <span class="adm-row-main">{{ e.detail }}</span>
            <span class="adm-row-date">{{ when(e.at) }}</span>
          </li>
        </ul>
      </section>
    </template>
  </AdminShell>
</template>
