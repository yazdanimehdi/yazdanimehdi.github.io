<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ApiError, api, report } from './api';
import { vDialog } from './dialog';
import { FIELD_LABELS, defaultTicked, displayValue, sourceLabel } from './paper-review';
import type { Completable, PaperProposal } from '../lib/admin/paper-complete';

const emit = defineEmits<{ close: [] }>();
const STEP = 10;

interface Block {
  proposal: PaperProposal;
  ticked: Record<string, boolean>;
  busy: boolean;
  message: string;
  stale: boolean;
}
const blocks = ref<Block[]>([]);
const total = ref(0);
const checked = ref(0);
const loading = ref(false);
let run = 0;

const block = (proposal: PaperProposal): Block =>
  reactive({
    proposal,
    ticked: Object.fromEntries(proposal.changes.map((c) => [c.field, defaultTicked(c)])),
    busy: false,
    message: '',
    stale: false,
  });

async function load() {
  const mine = ++run;
  blocks.value = [];
  checked.value = 0;
  loading.value = true;
  try {
    let offset = 0;
    do {
      const r = await api<{ total: number; offset: number; proposals: PaperProposal[] }>(
        `papers/complete?offset=${offset}&limit=${STEP}`,
      );
      if (mine !== run) return;
      total.value = r.total;
      blocks.value.push(...r.proposals.map(block));
      // A batch that moves nowhere would loop for ever.
      if (r.offset <= offset) break;
      offset = r.offset;
      checked.value = Math.min(offset, r.total);
    } while (offset < total.value);
  } catch (e) {
    if (mine === run) report(e);
  } finally {
    if (mine === run) loading.value = false;
  }
}

async function apply(b: Block) {
  b.busy = true;
  b.message = '';
  const pick = (on: boolean) => b.proposal.changes.filter((c) => !!b.ticked[c.field] === on);
  try {
    const next = await api<PaperProposal>('papers/complete', {
      method: 'POST',
      body: {
        slug: b.proposal.slug,
        apply: pick(true).map((c) => ({ field: c.field, value: c.to, from: c.from })),
        decline: pick(false).map((c) => ({ field: c.field, value: c.to })),
      },
    });
    Object.assign(b, block(next));
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      b.message = e.message;
      b.stale = true;
    } else b.message = e instanceof Error ? e.message : String(e);
  } finally {
    b.busy = false;
  }
}

const withChanges = computed(() => blocks.value.filter((b) => b.proposal.changes.length));
const failed = computed(() => blocks.value.filter((b) => b.proposal.error || b.proposal.noMatch));
const upToDate = computed(() => blocks.value.length - withChanges.value.length - failed.value.length);
const long = (f: Completable) => f === 'abstract' || f === 'bibtex';

onMounted(load);
onBeforeUnmount(() => run++);
</script>

<template>
  <div
    v-dialog
    class="adm-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Complete papers"
    @keydown.esc="emit('close')"
  >
    <div>
      <div class="adm-head">
        <h2 class="adm-h2">Complete papers from arXiv and Crossref</h2>
        <button type="button" class="adm-btn adm-btn-small" @click="emit('close')">Close</button>
      </div>
      <p>
        Empty fields are ticked. Changes to what you have are not; tick the ones you want. Unticked changes won't be
        offered again.
      </p>
      <p v-if="loading" class="adm-muted" role="status">Checking papers… {{ checked }} of {{ total }}</p>
      <p v-else class="adm-muted" role="status">Checked {{ blocks.length }} papers. {{ upToDate }} up to date.</p>
      <section v-for="b in withChanges" :key="b.proposal.slug" class="adm-card" :aria-label="b.proposal.title">
        <h3 class="adm-h3">{{ b.proposal.title }}</h3>
        <ul class="adm-review-changes">
          <li v-for="c in b.proposal.changes" :key="c.field">
            <label>
              <input v-model="b.ticked[c.field]" type="checkbox" :disabled="b.busy" />
              <strong>{{ FIELD_LABELS[c.field] }}</strong>
              <span v-if="c.source" class="adm-muted"> from {{ sourceLabel(c.source) }}</span>
            </label>
            <div class="adm-review-pair">
              <div>
                <span class="adm-muted">Now</span>
                <pre v-if="long(c.field)" class="adm-job-text adm-review-long">{{ displayValue(c.field, c.from) }}</pre>
                <span v-else class="adm-job-text">{{ displayValue(c.field, c.from) }}</span>
              </div>
              <div>
                <span class="adm-muted">Proposed</span>
                <pre v-if="long(c.field)" class="adm-job-text adm-review-long">{{ displayValue(c.field, c.to) }}</pre>
                <span v-else class="adm-job-text">{{ displayValue(c.field, c.to) }}</span>
              </div>
            </div>
          </li>
        </ul>
        <p v-if="b.message" class="adm-err" role="alert">
          {{ b.message }}
          <button v-if="b.stale" type="button" class="adm-btn adm-btn-small" @click="load">Reload the review</button>
        </p>
        <button type="button" class="adm-btn adm-btn-primary" :disabled="b.busy" @click="apply(b)">
          {{ b.busy ? 'Applying…' : 'Apply selected' }}
        </button>
      </section>
      <section v-if="failed.length" aria-label="Couldn't complete">
        <h3 class="adm-h3">Couldn't complete</h3>
        <ul>
          <li v-for="b in failed" :key="b.proposal.slug">
            {{ b.proposal.title }}:
            <span class="adm-muted">{{ b.proposal.error ?? 'No matching record found' }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
