<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import FormFields from './FormFields.vue';
import { ApiError, api, report, toast } from './api';
import { text, type FieldDef } from './fields';
import { detectAts } from '../lib/career/sources/detect';
import type { ApplicationAnswers, CareerPrefs } from '../lib/career/settings';
import type { SecretStatus } from '../lib/admin/secrets';
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
const keys = ref<SecretStatus[]>([]);
const typed = ref<Record<string, string>>({});
const savingKey = ref('');
const saving = ref(false);
const errors = ref<Record<string, string>>({});

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
  strings('locations', 'Locations'),
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
    label: 'Scores per night',
    type: 'number',
    hint: 'Each score is one AI call. The rest wait for the next night.',
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

async function load() {
  try {
    const s = await api<{ prefs: CareerPrefs; answers: ApplicationAnswers }>('career/settings');
    prefs.value = s.prefs;
    answers.value = s.answers;
    floor.value = { ...s.prefs.salaryFloor };
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
    prefs.value = s.prefs;
    answers.value = s.answers;
    floor.value = { ...s.prefs.salaryFloor };
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

const status = (k: SecretStatus) =>
  k.source === 'admin' ? `Set in admin · …${k.last4}` : k.source === 'env' ? 'From environment' : 'Not set';

async function saveKey(name: string, value: string | null) {
  savingKey.value = name;
  try {
    keys.value = await api<SecretStatus[]>('career/keys', { method: 'PUT', body: { name, value } });
    typed.value[name] = '';
    toast(value ? 'Key saved' : 'Key cleared');
  } catch (e) {
    report(e);
  } finally {
    savingKey.value = '';
  }
}

onMounted(async () => {
  void load();
  const [k, s, c] = await Promise.allSettled([
    api<SecretStatus[]>('career/keys'),
    api<{ sources: SourceInfo[]; suggestedFeeds: { label: string; url: string }[] }>('career/sources'),
    api<{ data: CvStylesConfig }>('cv/styles'),
  ]);
  if (k.status === 'fulfilled') keys.value = k.value;
  else report(k.reason);
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

    <template v-if="prefs && answers">
      <fieldset class="adm-group">
        <legend>What I want</legend>
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
            <small v-if="s.needs.length">Needs {{ s.needs.join(', ') }} (see Keys below).</small>
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

    <section id="keys" class="adm-form" aria-labelledby="adm-keys">
      <h2 id="adm-keys" class="adm-h2">Keys</h2>
      <p class="adm-muted">
        Keys typed here are stored encrypted in the database. Without one, the environment variable of the same name is
        used.
      </p>
      <table class="adm-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Status</th>
            <th><span class="adm-visually-hidden">Change</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k.name">
            <td>
              {{ k.label }}<br /><code class="adm-muted">{{ k.name }}</code>
            </td>
            <td>
              {{ status(k) }}
              <span v-if="k.undecryptable" class="adm-err">
                The stored key can’t be decrypted (SESSION_SECRET changed): enter it again.
              </span>
            </td>
            <td>
              <form class="adm-actions" @submit.prevent="saveKey(k.name, typed[k.name] ?? '')">
                <input
                  v-model="typed[k.name]"
                  type="password"
                  autocomplete="off"
                  :aria-label="`New ${k.label} key`"
                  placeholder="Paste a new key"
                />
                <button
                  type="submit"
                  class="adm-btn adm-btn-small adm-btn-primary"
                  :disabled="savingKey === k.name || !typed[k.name]"
                >
                  Save
                </button>
                <button
                  v-if="k.source === 'admin' || k.undecryptable"
                  type="button"
                  class="adm-btn adm-btn-small"
                  :disabled="savingKey === k.name"
                  @click="saveKey(k.name, null)"
                >
                  Clear
                </button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </AdminShell>
</template>
