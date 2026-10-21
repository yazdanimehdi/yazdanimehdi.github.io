<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, report, toast } from './api';
import { httpUrl, visible } from './career';
import { PostingText } from './PostingText';
import type { AdminCtx } from './types';
import { entryText } from '../lib/career/profile';
import type { ScoreDetail } from '../lib/career/score';
import type { ReviewIssue, TailorPlan } from '../lib/career/tailor';
import type { Posting, PostingStatus } from '../lib/career/types';
import type { CvConfig } from '../lib/types';

// Every string from the posting is third-party text, and the letter and review issues are AI output derived from it:
// shown with {{ }} or in textareas only, never as HTML.
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

type Part = 'all' | 'cv' | 'letter' | 'render';
type Plan = Pick<TailorPlan, 'sections'>;
interface EditEntry {
  ref: number;
  on: boolean;
  label: string;
  text?: string;
  /** One per line. */
  highlights?: string;
  max?: number;
}
interface EditSection {
  title: string;
  on: boolean;
  entries: EditEntry[];
}

const posting = ref<Posting | null>(null);
const events = ref<JobEvent[]>([]);
const notes = ref('');
const loading = ref(true);
const missing = ref(false);
const cvSections = ref<CvConfig['cv']['sections']>({});
const letter = ref('');
const instruction = reactive({ all: '', cv: '', letter: '' });
const editor = ref<EditSection[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;

const detail = computed(() => posting.value?.scoreDetail as ScoreDetail | null);
const link = computed(() => httpUrl(posting.value?.url));
const applyLink = computed(() => httpUrl(posting.value?.applyUrl));
const when = (iso: string) => new Date(iso).toLocaleString();
const drafting = computed(() => posting.value?.draftState === 'running');
const issues = computed(() =>
  posting.value?.draftState === 'needs-review' ? ((posting.value.draftIssues as ReviewIssue[] | null) ?? []) : [],
);
const pdf = computed(() => httpUrl(posting.value?.cvPdfUrl));
/** Only our own Blob store's PDFs are embedded; any other URL is just a link. */
const embed = computed(() => {
  try {
    const u = new URL(pdf.value ?? '');
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com') ? u.href : null;
  } catch {
    return null;
  }
});

/** The plan editor: the plan's sections and entries first, in plan order, then the rest of the CV switched off. */
function buildEditor() {
  const plan = (posting.value?.cv as Plan | null)?.sections ?? [];
  const own = cvSections.value;
  const titles = [...plan.map((s) => s.title), ...Object.keys(own)].filter(
    (t, i, all) => Object.hasOwn(own, t) && all.indexOf(t) === i,
  );
  editor.value = titles.map((title) => {
    const entries = (own[title] ?? []) as unknown[];
    const chosen = plan.find((s) => s.title === title)?.entries ?? [];
    const refs = [...chosen.map((e) => e.ref), ...entries.keys()].filter(
      (r, i, all) => r < entries.length && all.indexOf(r) === i,
    );
    return {
      title,
      on: chosen.length > 0,
      entries: refs.map((ref) => {
        const entry = entries[ref];
        const picked = chosen.find((e) => e.ref === ref);
        const had = (entry as { highlights?: unknown })?.highlights;
        return {
          ref,
          on: !!picked,
          label: entryText(entry).split('\n')[0] || '(hidden entry)',
          ...(typeof entry === 'string' ? { text: picked?.text ?? entry } : {}),
          ...(Array.isArray(had) ? { highlights: (picked?.highlights ?? had).join('\n'), max: had.length } : {}),
        };
      }),
    };
  });
}

function take(res: { posting: Posting; events: JobEvent[] }) {
  posting.value = res.posting;
  events.value = res.events;
  notes.value = res.posting.notes;
  letter.value = res.posting.letter ?? '';
  buildEditor();
}

async function patch(body: { status?: PostingStatus; notes?: string; cv?: Plan; letter?: string }) {
  try {
    take(await api(`career/postings/${props.id}`, { method: 'PATCH', body }));
    return true;
  } catch (e) {
    report(e);
    return false;
  }
}

/** A failed save puts the select back on the saved status. */
async function setStatus(el: HTMLSelectElement) {
  if (!(await patch({ status: el.value as PostingStatus }))) el.value = posting.value!.status;
}

function stop() {
  clearInterval(timer);
  timer = undefined;
}
async function poll() {
  try {
    const res = await api<{ posting: Posting; events: JobEvent[] }>(`career/postings/${props.id}`);
    if (res.posting.draftState !== 'running') {
      stop();
      take(res);
    }
  } catch (e) {
    stop();
    report(e);
  }
}

async function draft(part: Part) {
  try {
    await api(`career/postings/${props.id}/draft`, {
      body: { part, instruction: part === 'render' ? '' : instruction[part] },
    });
    posting.value = { ...posting.value!, draftState: 'running' };
    timer ??= setInterval(poll, 5000);
  } catch (e) {
    report(e);
  }
}

function move(i: number, by: number) {
  const list = editor.value;
  [list[i], list[i + by]] = [list[i + by], list[i]];
}

/** Saves the edited plan, then re-renders it (no AI). */
async function savePlan() {
  const cv: Plan = {
    sections: editor.value
      .filter((s) => s.on)
      .map((s) => ({
        title: s.title,
        entries: s.entries
          .filter((e) => e.on)
          .map((e) => ({
            ref: e.ref,
            ...(e.text === undefined ? {} : { text: e.text }),
            ...(e.highlights === undefined
              ? {}
              : {
                  highlights: e.highlights
                    .split('\n')
                    .map((h) => h.trim())
                    .filter(Boolean),
                }),
          })),
      })),
  };
  if (await patch({ cv })) await draft('render');
}

function copyLetter() {
  navigator.clipboard.writeText(letter.value).then(() => toast('Copied'), report);
}

function downloadLetter() {
  const company = posting
    .value!.company.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const url = URL.createObjectURL(new Blob([letter.value], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `cover-letter-${company || 'company'}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

onBeforeUnmount(stop);
onMounted(async () => {
  try {
    const [res, cv] = await Promise.all([
      api<{ posting: Posting; events: JobEvent[] }>(`career/postings/${props.id}`),
      api<{ data: Partial<CvConfig> }>('config/cv').catch(() => ({ data: {} as Partial<CvConfig> })),
    ]);
    cvSections.value = cv.data.cv?.sections ?? {};
    take(res);
    if (res.posting.draftState === 'running') timer ??= setInterval(poll, 5000);
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
        <p v-if="posting.gate" class="adm-err">Filtered out: {{ visible(posting.gate) }}</p>
        <p v-if="posting.scoreError" class="adm-err">Scoring failed: {{ visible(posting.scoreError) }}</p>
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
            {{ VERDICTS.map((v) => `${v}: ${detail[v]}`).join(' · ') }}
          </p>
          <template v-if="detail.strengths?.length">
            <h3>Strengths</h3>
            <ul>
              <li v-for="s in detail.strengths" :key="s">{{ visible(s) }}</li>
            </ul>
          </template>
          <template v-if="detail.gaps?.length">
            <h3>Gaps</h3>
            <ul>
              <li v-for="g in detail.gaps" :key="g">{{ visible(g) }}</li>
            </ul>
          </template>
          <p v-if="detail.notes" class="adm-muted">{{ visible(detail.notes) }}</p>
        </template>
      </section>

      <section class="adm-card" aria-labelledby="job-status">
        <h2 id="job-status" class="adm-h2">Status</h2>
        <label class="adm-field">
          <span>Status</span>
          <select :value="posting.status" @change="setStatus($event.target as HTMLSelectElement)">
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="adm-field">
          <span>Notes</span>
          <textarea v-model="notes" rows="4" maxlength="20000" @blur="notes !== posting.notes && patch({ notes })" />
        </label>
      </section>

      <section class="adm-card" aria-labelledby="job-draft">
        <h2 id="job-draft" class="adm-h2">Application draft</h2>
        <p aria-live="polite" class="adm-muted">
          <template v-if="drafting">Drafting… this takes a minute or two.</template>
          <template v-else-if="posting.draftState === 'failed'">The last draft failed: see History for why.</template>
          <template v-else-if="posting.draftState === 'none'">No draft yet.</template>
          <template v-else-if="posting.draftState === 'done'"
            >Drafted, and the review found nothing unsupported.</template
          >
        </p>
        <div v-if="issues.length || posting.draftState === 'needs-review'" class="adm-banner" role="alert">
          <div>
            <strong>Check these before sending:</strong> the reviewer still found claims the CV may not support.
            <ul>
              <li v-for="(i, n) in issues" :key="n">
                {{ visible(i.where) }}: “{{ visible(i.claim) }}”, {{ visible(i.why) }}
              </li>
            </ul>
          </div>
        </div>
        <label class="adm-field">
          <span>Instruction (optional)</span>
          <input v-model="instruction.all" maxlength="500" placeholder="e.g. lead with the teaching experience" />
        </label>
        <p class="adm-actions">
          <button class="adm-btn" :disabled="drafting" @click="draft('all')">
            {{ posting.draftState === 'none' ? 'Draft CV and letter' : 'Regenerate both' }}
          </button>
        </p>
      </section>

      <section v-if="posting.cv" class="adm-card" aria-labelledby="job-cv">
        <h2 id="job-cv" class="adm-h2">Tailored CV</h2>
        <p v-if="pdf" class="adm-actions">
          <a class="adm-btn" :href="pdf" target="_blank" rel="noopener noreferrer">Open PDF</a>
        </p>
        <p v-else class="adm-muted">No PDF yet.</p>
        <iframe v-if="embed" :src="embed" title="Tailored CV preview" class="adm-job-pdf" />
        <label class="adm-field">
          <span>Regenerate with an instruction</span>
          <input v-model="instruction.cv" maxlength="500" placeholder="e.g. one page, drop the awards" />
        </label>
        <p class="adm-actions">
          <button class="adm-btn" :disabled="drafting" @click="draft('cv')">Regenerate CV</button>
        </p>
        <details>
          <summary>Edit the plan</summary>
          <p class="adm-muted">
            Sections and entries come from your CV. Reword highlights freely, one per line, up to the entry’s own count.
          </p>
          <fieldset v-for="(s, i) in editor" :key="s.title" class="adm-job-plan">
            <legend>
              <label><input v-model="s.on" type="checkbox" /> {{ s.title }}</label>
            </legend>
            <p class="adm-actions">
              <button class="adm-btn" :disabled="i === 0" :aria-label="`Move ${s.title} up`" @click="move(i, -1)">
                ↑
              </button>
              <button
                class="adm-btn"
                :disabled="i === editor.length - 1"
                :aria-label="`Move ${s.title} down`"
                @click="move(i, 1)"
              >
                ↓
              </button>
            </p>
            <template v-if="s.on">
              <div v-for="e in s.entries" :key="e.ref">
                <label v-if="e.text === undefined"><input v-model="e.on" type="checkbox" /> {{ e.label }}</label>
                <label v-else class="adm-field">
                  <span><input v-model="e.on" type="checkbox" /> Line {{ e.ref + 1 }}</span>
                  <input v-if="e.on" v-model="e.text" maxlength="2000" />
                </label>
                <label v-if="e.on && e.highlights !== undefined" class="adm-field">
                  <span>Highlights (at most {{ e.max }})</span>
                  <textarea v-model="e.highlights" :rows="Math.max(2, e.max ?? 0)" />
                </label>
              </div>
            </template>
          </fieldset>
          <p class="adm-actions">
            <button class="adm-btn" :disabled="drafting" @click="savePlan">Save and re-render</button>
          </p>
        </details>
      </section>

      <section v-if="posting.letter !== null" class="adm-card" aria-labelledby="job-letter">
        <h2 id="job-letter" class="adm-h2">Cover letter</h2>
        <label class="adm-field">
          <span>Letter</span>
          <textarea
            v-model="letter"
            rows="16"
            maxlength="20000"
            @blur="letter !== posting.letter && patch({ letter })"
          />
        </label>
        <p class="adm-actions">
          <button class="adm-btn" @click="copyLetter">Copy</button>
          <button class="adm-btn" @click="downloadLetter">Download .txt</button>
        </p>
        <label class="adm-field">
          <span>Regenerate with an instruction</span>
          <input v-model="instruction.letter" maxlength="500" placeholder="e.g. warmer, mention remote work" />
        </label>
        <p class="adm-actions">
          <button class="adm-btn" :disabled="drafting" @click="draft('letter')">Regenerate letter</button>
        </p>
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
