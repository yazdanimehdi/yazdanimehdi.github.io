<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminSections from './AdminSections.vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import FormFields from './FormFields.vue';
import { ApiError, api, report, session, toast } from './api';
import { text, type FieldDef } from './fields';
import { LIMIT_FIELDS, STAGES, WORKER_KEYS, WORKERS, type WorkerChoice } from './career';
import { detectAts } from '../lib/career/sources/detect';
import type { ApplicationAnswers, CareerPrefs } from '../lib/career/settings';
import type { AdminCtx } from './types';
import type { CvConfig, CvStylesConfig } from '../lib/types';
import type { SecretName, SecretStatus } from '../lib/admin/secrets';

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
// Suggestions filled in and not yet saved: the banner shows until Save.
const filled = ref(false);
const section = ref('');
// What was loaded or last saved, to tell whether the form has unsaved changes.
const snapshot = () => JSON.stringify([prefs.value, answers.value, floor.value]);
const saved = ref('');
const dirty = computed(() => !!saved.value && snapshot() !== saved.value);
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

// `fields`: the error keys (prefs and answers paths, unprefixed) each section owns, for its error dot.
const SECTIONS = [
  { id: 'want', label: 'What I want', fields: [...WANT_FIELDS.map((f) => f.key), 'salaryFloor'] },
  { id: 'sources', label: 'Sources', fields: ['sources', 'watched', 'feeds'] },
  { id: 'cv', label: 'Tailored CV', fields: ['cvStyle'] },
  { id: 'answers', label: 'Application answers', fields: ANSWER_FIELDS.map((f) => f.key) },
  { id: 'automation', label: 'Automation', fields: ['nightly'] },
  { id: 'notifications', label: 'Notifications', fields: ['digest'] },
  { id: 'worker', label: 'Drafting worker', fields: ['worker'] },
];

/** The drafting worker as one choice; picking an agent CLI keeps the sign-in chosen before (Gemini: a key only). */
function workerOf(p: CareerPrefs): WorkerChoice {
  return p.worker.kind === 'cli' ? p.worker.agent : 'api';
}
function setWorker(v: WorkerChoice) {
  const was = prefs.value!.worker;
  prefs.value!.worker =
    v === 'api'
      ? { kind: 'api' }
      : { kind: 'cli', agent: v, auth: v === 'gemini' ? 'key' : was.kind === 'cli' ? was.auth : 'subscription' };
}
const keys = ref<SecretStatus[] | null>(null);
const keyOf = (name: SecretName) => keys.value?.find((k) => k.name === name);
function keySet(name: SecretName) {
  return !!keyOf(name)?.source && !keyOf(name)?.undecryptable;
}
/** The key the chosen agent CLI signs in with, if it is one. */
function needed(): SecretName | null {
  const w = prefs.value?.worker;
  return w?.kind === 'cli' ? WORKER_KEYS[w.agent][w.auth] : null;
}
const cvEmail = ref('');

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
        filled.value = true;
      }
    const a = answers.value!;
    const fill = <K extends 'phone' | 'address' | 'links'>(k: K, empty: boolean) => {
      if (!empty || !s.answers[k].length) return;
      a[k] = s.answers[k];
      filled.value = true;
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
    saved.value = snapshot();
    const p = s.prefs;
    if (![p.roles, p.keywords, p.fields, p.watched, p.feeds].some((l) => l.length)) void suggest(false);
  } catch (e) {
    report(e);
  }
}

/** Preferences and answers in one PUT; a field error opens the section that holds it. */
async function save() {
  const f = floor.value;
  const salaryFloor =
    f.amount === undefined ? null : { amount: f.amount, currency: f.currency ?? '', period: f.period ?? 'year' };
  saving.value = true;
  errors.value = {};
  try {
    const s = await api<{ prefs: CareerPrefs; answers: ApplicationAnswers }>('career/settings', {
      method: 'PUT',
      body: { prefs: { ...prefs.value!, salaryFloor }, answers: answers.value },
    });
    prefs.value = s.prefs;
    answers.value = s.answers;
    floor.value = { ...s.prefs.salaryFloor };
    saved.value = snapshot();
    filled.value = false;
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
  // Only for the Notifications and Drafting worker notes: a failure leaves those notes out, not the form.
  const [career, ai, cv] = await Promise.allSettled([
    api<SecretStatus[]>('career/keys'),
    api<SecretStatus[]>('ai/keys'),
    api<{ data: CvConfig }>('config/cv'),
  ]);
  keys.value = [career, ai].flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (cv.status === 'fulfilled') cvEmail.value = cv.value.data.cv?.email ?? '';
});
</script>

<template>
  <AdminShell :ctx="ctx" active="career" title="Job search settings" :dirty="dirty">
    <template #actions>
      <button type="button" class="adm-btn adm-btn-primary" :disabled="saving || !prefs" @click="save">Save</button>
    </template>
    <AdminTabLinks
      label="Job search"
      :tabs="[
        { href: `${base}/career`, label: 'Postings' },
        { href: `${base}/career?status=ready`, label: 'Ready for approval', count: session.careerReady ?? undefined },
        { href: `${base}/career/settings`, label: 'Settings', current: true },
      ]"
    />

    <template v-if="prefs && answers">
      <p v-if="suggestError" class="adm-banner adm-banner-error" role="alert">
        {{ suggestError }}
        <a v-if="/ is not set/.test(suggestError)" :href="`${base}/ai#keys`">Add the key</a>
      </p>
      <p v-else-if="filled" class="adm-banner" role="status">
        Suggested from your CV and publications. Review, then Save.
      </p>
      <AdminSections v-model="section" :sections="SECTIONS" :errors="errors">
        <template #want>
          <div class="adm-actions">
            <button type="button" class="adm-btn adm-btn-small" :disabled="suggesting" @click="suggest(true)">
              {{ suggesting ? 'Suggesting…' : 'Suggest from my site' }}
            </button>
          </div>
          <FormFields :fields="WANT_FIELDS" :model="prefs" :errors="errors" />
          <FormFields :fields="FLOOR_FIELDS" :model="floor" />
        </template>

        <template #sources>
          <p class="adm-muted">Keys for job sources are on <a :href="`${base}/ai#keys`">Integrations → Keys</a>.</p>
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

          <h2 class="adm-subhead">Watched companies</h2>
          <FormFields :fields="WATCHED_FIELDS" :model="prefs" :errors="errors" />
          <ul v-if="prefs.watched.length" class="adm-rows">
            <li v-for="(url, i) in prefs.watched" :key="i">
              <span class="adm-row-main">{{ url }}</span>
              <span class="adm-row-date">{{ boardLabel(url) }}</span>
            </li>
          </ul>

          <h2 class="adm-subhead">Feeds</h2>
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
        </template>

        <template #cv>
          <label class="adm-field">
            <span>CV style for tailored CVs</span>
            <select v-model="prefs.cvStyle">
              <option value="">Public style</option>
              <option v-for="s in styles" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </label>
        </template>

        <template #answers>
          <p class="adm-muted">
            Used to fill application forms. Anything left empty is handed back to you, never guessed.
          </p>
          <FormFields :fields="ANSWER_FIELDS" :model="answers" :errors="errors" />
        </template>

        <template #automation>
          <div class="adm-form adm-fields">
            <fieldset class="adm-choices">
              <legend>How far the nightly run goes</legend>
              <label v-for="[n, label, line] in STAGES" :key="n" class="adm-check">
                <input v-model="prefs.nightly.stage" type="radio" name="stage" :value="n" />
                <span
                  >{{ label }}<span class="adm-row-detail">{{ line }}</span></span
                >
              </label>
            </fieldset>
            <p class="adm-muted">Submission always waits for your approval.</p>
          </div>
          <h2 class="adm-subhead">Limits</h2>
          <FormFields :fields="LIMIT_FIELDS" :model="prefs" :errors="errors" />
        </template>

        <template #notifications>
          <p class="adm-muted">
            The dashboard and the sidebar always show what waits for approval, and so does the Ready for approval tab.
          </p>
          <h2 class="adm-subhead">Email digest</h2>
          <p v-if="keys && !keySet('RESEND_API_KEY')" class="adm-banner" role="note">
            <span
              >The digest is sent through Resend, and there is no Resend key yet.
              <a :href="`${base}/ai#keys`">Add it on Integrations → Keys</a>.</span
            >
          </p>
          <div class="adm-form adm-fields">
            <label class="adm-check">
              <input v-model="prefs.digest.on" type="checkbox" />
              Email me a digest after each nightly run
            </label>
            <label class="adm-field">
              <span>To</span>
              <input
                v-model="prefs.digest.to"
                type="email"
                autocomplete="email"
                :placeholder="cvEmail || 'you@example.org'"
                v-bind="errors['digest.to'] ? { 'aria-invalid': 'true' } : {}"
              />
              <span v-if="errors['digest.to']" class="adm-err">{{ errors['digest.to'] }}</span>
            </label>
            <label class="adm-field">
              <span>From</span>
              <input v-model="prefs.digest.from" type="text" placeholder="ScholarOS <onboarding@resend.dev>" />
              <small
                >onboarding@resend.dev only delivers to your Resend account’s email until you verify a domain.</small
              >
              <span v-if="errors['digest.from']" class="adm-err">{{ errors['digest.from'] }}</span>
            </label>
          </div>
        </template>

        <template #worker>
          <div class="adm-form adm-fields">
            <fieldset class="adm-choices">
              <legend>Drafts, their review and form answers are written by</legend>
              <label v-for="[id, label, line] in WORKERS" :key="id" class="adm-check">
                <input
                  type="radio"
                  name="worker"
                  :value="id"
                  :checked="workerOf(prefs) === id"
                  @change="setWorker(id)"
                />
                <span
                  >{{ label }}<span class="adm-row-detail">{{ line }}</span></span
                >
              </label>
            </fieldset>
            <p v-if="workerOf(prefs) === 'gemini'" class="adm-muted">
              Antigravity has no sign-in that works unattended yet, so this slot runs Gemini CLI with your Gemini API
              key.
            </p>
            <fieldset v-if="prefs.worker.kind === 'cli' && prefs.worker.agent !== 'gemini'" class="adm-choices">
              <legend>Sign in with</legend>
              <label class="adm-check">
                <input v-model="prefs.worker.auth" type="radio" name="auth" value="subscription" />
                <span
                  >Subscription<span class="adm-row-detail">{{
                    prefs.worker.agent === 'claude'
                      ? 'Your Claude plan, through a Claude Code token.'
                      : 'Your ChatGPT plan, through Codex’s sign-in file.'
                  }}</span></span
                >
              </label>
              <label class="adm-check">
                <input v-model="prefs.worker.auth" type="radio" name="auth" value="key" />
                <span
                  >Key<span class="adm-row-detail">{{
                    prefs.worker.agent === 'claude'
                      ? 'Your Anthropic API key, billed per use.'
                      : 'Your OpenAI API key, billed per use.'
                  }}</span></span
                >
              </label>
            </fieldset>
            <p v-if="needed()" class="adm-muted">
              Uses {{ keyOf(needed()!)?.label ?? needed() }} (<code>{{ needed() }}</code
              >)<template v-if="keys && !keySet(needed()!)">, which isn’t set yet</template>:
              <a :href="`${base}/ai#keys`">Integrations → Keys</a>.
            </p>
            <p v-if="prefs.worker.kind === 'cli'" class="adm-muted">
              When a subscription runs out of quota, the run stops and says so. It never falls back to paid API use.
            </p>
            <p class="adm-muted">Scoring always uses the API provider.</p>
          </div>
        </template>
      </AdminSections>
    </template>
  </AdminShell>
</template>
