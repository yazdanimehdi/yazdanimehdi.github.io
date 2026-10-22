<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import FormFields from './FormFields.vue';
import { ApiError, api, report, toast } from './api';
import { text, type FieldDef } from './fields';
import { detectAts } from '../lib/career/sources/detect';
import type { ApplicationAnswers, CareerPrefs } from '../lib/career/settings';
import type { AdminCtx } from './types';
import type { CvStylesConfig } from '../lib/types';

interface SourceInfo {
  id: string;
  label: string;
  needs: string[];
  defaultOn: boolean;
  warning: string | null;
}
type Floor = { amount?: number; currency?: string; period?: string };

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const prefs = ref<CareerPrefs | null>(null);
const answers = ref<ApplicationAnswers | null>(null);
const floor = ref<Floor>({});
const sources = ref<SourceInfo[]>([]);
const suggested = ref<{ label: string; url: string }[]>([]);
const styles = ref<{ id: string; name: string }[]>([]);
const saving = ref(false);
const errors = ref<Record<string, string>>({});
// Which sections hold suggestions not yet saved; the banner shows while either does.
const unsaved = ref({ prefs: false, answers: false });
const suggestError = ref('');
const suggesting = ref(false);

// Per-source settings the source reads from `prefs.sources[id].options`.
const SOURCE_OPTIONS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  adzuna: [{ key: 'country', label: 'Country code', placeholder: 'us' }],
  usajobs: [{ key: 'email', label: 'Contact email', placeholder: 'you@example.org' }],
};

const strings = (key: string, label: string, hint?: string): FieldDef => ({ key, label, type: 'list', hint });
const WANT_FIELDS: FieldDef[] = [
  strings('roles', 'Roles'),
  strings('keywords', 'Keywords'),
  strings('seniority', 'Seniority'),
  strings('locations', 'Locations', "Postings outside these places that aren't remote are filtered out."),
  {
    key: 'remote',
    label: 'Remote',
    type: 'select',
    options: ['any', 'remote', 'hybrid', 'onsite'],
  },
  {
    key: 'languages',
    label: 'Languages',
    type: 'objects',
    fields: [text('language', 'Language'), text('level', 'Level')],
  },
  strings('fields', 'Fields'),
  strings('mustHaves', 'Must have'),
  strings('dealBreakers', 'Deal breakers'),
  strings('avoidCompanies', 'Avoid companies'),
  {
    key: 'threshold',
    label: 'Match threshold (0–100)',
    type: 'number',
    hint: 'Postings scored at or above this show as matches.',
  },
  {
    key: 'maxScoresPerRun',
    label: 'Scores per run',
    type: 'number',
    hint: 'Per run: each score is one AI call, up to three when a reply is malformed. The rest wait for the next run.',
  },
];
const FLOOR_FIELDS: FieldDef[] = [
  { key: 'amount', label: 'Salary floor', type: 'number', hint: 'Empty means no floor.' },
  text('currency', 'Currency (e.g. USD)'),
  { key: 'period', label: 'Per', type: 'select', options: ['year', 'month', 'hour'] },
];
const WATCHED_FIELDS: FieldDef[] = [strings('watched', 'Careers page or job board URLs')];
const FEED_FIELDS: FieldDef[] = [strings('feeds', 'RSS or Atom feed URLs')];
const ANSWER_FIELDS: FieldDef[] = [
  text('workAuthorization', 'Work authorization'),
  { key: 'sponsorship', label: 'Needs visa sponsorship', type: 'select', options: ['', 'yes', 'no'] },
  text('noticePeriod', 'Notice period'),
  text('earliestStart', 'Earliest start'),
  text('salaryExpectation', 'Salary expectation'),
  text('phone', 'Phone'),
  { key: 'address', label: 'Address', type: 'textarea' },
  {
    key: 'links',
    label: 'Links',
    type: 'objects',
    fields: [text('label', 'Label'), text('url', 'URL')],
  },
  { key: 'whyLooking', label: 'Why I am looking', type: 'textarea' },
  {
    key: 'eeo.mode',
    label: 'Voluntary self-identification questions',
    type: 'select',
    options: [
      { value: 'decline', label: 'Always decline to answer' },
      { value: 'answer', label: 'Answer as below' },
    ],
  },
  text('eeo.gender', 'Gender'),
  text('eeo.race', 'Race or ethnicity'),
  text('eeo.veteran', 'Veteran status'),
  text('eeo.disability', 'Disability status'),
];

const isOn = (s: SourceInfo) => prefs.value?.sources[s.id]?.on ?? s.defaultOn;
function setOn(s: SourceInfo, on: boolean) {
  const p = prefs.value!;
  p.sources[s.id] = { ...p.sources[s.id], on };
}
const option = (id: string, key: string) => prefs.value?.sources[id]?.options?.[key] ?? '';
function setOption(s: SourceInfo, key: string, value: string) {
  const p = prefs.value!;
  const options = { ...p.sources[s.id]?.options, [key]: value };
  if (!value) delete options[key];
  p.sources[s.id] = { on: isOn(s), options };
}

const BOARD_LABEL: Record<string, string> = { greenhouse: 'Greenhouse board' };
const boardLabel = (url: string) => {
  const ats = detectAts(url);
  return ats ? (BOARD_LABEL[ats.kind] ?? `${ats.kind[0].toUpperCase()}${ats.kind.slice(1)} board`) : 'Careers page';
};

function addFeed(url: string) {
  prefs.value!.feeds = [...prefs.value!.feeds, url];
}

const SUGGESTED_PREFS = ['roles', 'keywords', 'seniority', 'fields', 'locations', 'languages'] as const;

/**
 * Asks the server for settings suggested from the CV and publications; nothing is saved until Save. `replace` swaps
 * the suggested prefs in (the button); otherwise only empty ones are filled (the first visit). Locations and answers
 * only ever fill empty fields. A failure leaves the form as it was.
 */
async function suggest(replace: boolean) {
  suggesting.value = true;
  try {
    const s = await api<{
      prefs: Pick<CareerPrefs, (typeof SUGGESTED_PREFS)[number]>;
      answers: Pick<ApplicationAnswers, 'phone' | 'address' | 'links'>;
    }>('career/suggest', { method: 'POST' });
    const p = prefs.value!;
    for (const k of SUGGESTED_PREFS)
      if ((replace && k !== 'locations') || !p[k].length) {
        (p as Record<string, unknown>)[k] = s.prefs[k];
        unsaved.value.prefs = true;
      }
    const a = answers.value!;
    const fill = <K extends 'phone' | 'address' | 'links'>(k: K, empty: boolean) => {
      if (!empty || !s.answers[k].length) return;
      a[k] = s.answers[k];
      unsaved.value.answers = true;
    };
    fill('phone', !a.phone.trim());
    fill('address', !a.address.trim());
    fill('links', !a.links.length);
    suggestError.value = '';
  } catch (e) {
    suggestError.value = (e as Error).message;
  } finally {
    suggesting.value = false;
  }
}

async function load() {
  try {
    const s = await api<{ prefs: CareerPrefs; answers: ApplicationAnswers }>('career/settings');
    prefs.value = s.prefs;
    answers.value = s.answers;
    floor.value = { ...s.prefs.salaryFloor };
    const p = s.prefs;
    if (![p.roles, p.keywords, p.fields, p.watched, p.feeds].some((l) => l.length)) void suggest(false);
  } catch (e) {
    report(e);
  }
}

async function save(body: { prefs: CareerPrefs } | { answers: ApplicationAnswers }) {
  saving.value = true;
  errors.value = {};
  try {
    const s = await api<{ prefs: CareerPrefs; answers: ApplicationAnswers }>('career/settings', {
      method: 'PUT',
      body,
    });
    // Only the part sent is replaced, so the other section keeps its unsaved edits and suggestions.
    if ('prefs' in body) {
      prefs.value = s.prefs;
      floor.value = { ...s.prefs.salaryFloor };
      unsaved.value.prefs = false;
    } else {
      answers.value = s.answers;
      unsaved.value.answers = false;
    }
    suggestError.value = '';
    toast('Saved');
  } catch (e) {
    if (e instanceof ApiError && e.status === 400 && e.details && typeof e.details === 'object')
      errors.value = e.details as Record<string, string>;
    report(e);
  } finally {
    saving.value = false;
  }
}

function savePrefs() {
  const f = floor.value;
  const salaryFloor =
    f.amount === undefined ? null : { amount: f.amount, currency: f.currency ?? '', period: f.period ?? 'year' };
  return save({ prefs: { ...prefs.value!, salaryFloor } as CareerPrefs });
}

onMounted(async () => {
  void load();
  const [s, c] = await Promise.allSettled([
    api<{ sources: SourceInfo[]; suggestedFeeds: { label: string; url: string }[] }>('career/sources'),
    api<{ data: CvStylesConfig }>('cv/styles'),
  ]);
  if (s.status === 'fulfilled') {
    sources.value = s.value.sources;
    suggested.value = s.value.suggestedFeeds;
  } else report(s.reason);
  if (c.status === 'fulfilled') styles.value = c.value.data.styles.map(({ id, name }) => ({ id, name }));
});
</script>

<template>
  <AdminShell :ctx="ctx" active="career" title="Job search settings">
    <p><a :href="`${base}/career`">← Back to the feed</a></p>
    <p class="adm-muted">Keys for job sources are on <a :href="`${base}/ai#keys`">Integrations → Keys</a>.</p>

    <template v-if="prefs && answers">
      <p v-if="suggestError" class="adm-banner adm-banner-error" role="alert">
        {{ suggestError }}
        <a v-if="/ is not set/.test(suggestError)" :href="`${base}/ai#keys`">Add the key</a>
      </p>
      <p v-else-if="unsaved.prefs || unsaved.answers" class="adm-banner" role="status">
        Suggested from your CV and publications. Review, then Save.
      </p>
      <fieldset class="adm-group">
        <legend>What I want</legend>
        <div class="adm-actions">
          <button type="button" class="adm-btn adm-btn-small" :disabled="suggesting" @click="suggest(true)">
            {{ suggesting ? 'Suggesting…' : 'Suggest from my site' }}
          </button>
        </div>
        <FormFields :fields="WANT_FIELDS" :model="prefs" :errors="errors" />
        <FormFields :fields="FLOOR_FIELDS" :model="floor" />
      </fieldset>

      <fieldset class="adm-group">
        <legend>Sources</legend>
        <div class="adm-form">
          <div v-for="s in sources" :key="s.id" class="adm-field">
            <label class="adm-check">
              <input
                type="checkbox"
                :checked="isOn(s)"
                @change="setOn(s, ($event.target as HTMLInputElement).checked)"
              />
              {{ s.label }}
            </label>
            <small v-if="s.needs.length"
              >Needs {{ s.needs.join(', ') }} (<a :href="`${base}/ai#keys`">Integrations → Keys</a>).</small
            >
            <small v-if="s.warning" class="adm-err" role="note">{{ s.warning }}</small>
            <label v-for="o in SOURCE_OPTIONS[s.id] ?? []" :key="o.key" class="adm-field">
              <span>{{ s.label }}: {{ o.label }}</span>
              <input
                type="text"
                :value="option(s.id, o.key)"
                :placeholder="o.placeholder"
                @input="setOption(s, o.key, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset class="adm-group">
        <legend>Watched companies</legend>
        <FormFields :fields="WATCHED_FIELDS" :model="prefs" :errors="errors" />
        <ul v-if="prefs.watched.length" class="adm-rows">
          <li v-for="(url, i) in prefs.watched" :key="i">
            <span class="adm-row-main">{{ url }}</span>
            <span class="adm-row-date">{{ boardLabel(url) }}</span>
          </li>
        </ul>
      </fieldset>

      <fieldset class="adm-group">
        <legend>Feeds</legend>
        <FormFields :fields="FEED_FIELDS" :model="prefs" :errors="errors" />
        <template v-if="suggested.some((f) => !prefs!.feeds.includes(f.url))">
          <p class="adm-muted">Suggested academic feeds:</p>
          <div class="adm-actions">
            <button
              v-for="f in suggested.filter((f) => !prefs!.feeds.includes(f.url))"
              :key="f.url"
              type="button"
              class="adm-btn adm-btn-small"
              @click="addFeed(f.url)"
            >
              + {{ f.label }}
            </button>
          </div>
        </template>
      </fieldset>

      <fieldset class="adm-group">
        <legend>CV style for tailored CVs</legend>
        <label class="adm-field">
          <span>Style</span>
          <select v-model="prefs.cvStyle">
            <option value="">Public style</option>
            <option v-for="s in styles" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
      </fieldset>

      <div class="adm-actions">
        <button type="button" class="adm-btn adm-btn-primary" :disabled="saving" @click="savePrefs">
          Save preferences
        </button>
      </div>

      <fieldset class="adm-group">
        <legend>Application answers</legend>
        <p class="adm-muted">
          Used to fill application forms. Anything left empty is handed back to you, never guessed.
        </p>
        <FormFields :fields="ANSWER_FIELDS" :model="answers" :errors="errors" />
        <div class="adm-actions">
          <button type="button" class="adm-btn adm-btn-primary" :disabled="saving" @click="save({ answers: answers! })">
            Save answers
          </button>
        </div>
      </fieldset>
    </template>
  </AdminShell>
</template>
