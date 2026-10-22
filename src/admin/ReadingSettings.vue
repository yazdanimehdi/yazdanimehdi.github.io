<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminSections from './AdminSections.vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import FormFields from './FormFields.vue';
import { ApiError, api, report, toast } from './api';
import { text, type FieldDef } from './fields';
import { SOURCE_NAMES } from './reading';
import type { AdminCtx } from './types';
import type { ReadingPrefs } from '../lib/reading/settings';

type Keys = { OPENALEX_API_KEY: boolean; RESEND_API_KEY: boolean };
type Topic = { id: string; name: string; level: 'field' | 'subfield' };

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const prefs = ref<ReadingPrefs | null>(null);
const keys = ref<Keys | null>(null);
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const section = ref('');
const saved = ref('');
const dirty = computed(() => !!saved.value && JSON.stringify(prefs.value) !== saved.value);
// Suggestions filled in and not yet saved: the banner shows until Save.
const filled = ref(false);
const suggesting = ref(false);
const suggestError = ref('');

const list = (key: string, label: string, hint?: string): FieldDef => ({ key, label, type: 'list', hint });
const PROFILE_FIELDS: FieldDef[] = [
  { key: 'field', label: 'Field', type: 'textarea' },
  list('keywords', 'Keywords'),
  text('area', 'Wider area'),
];
const RXIV_HINT = "Lowercase words, '_' for spaces";
const SOURCES: { id: keyof ReadingPrefs['sources']; note?: string; fields?: FieldDef[] }[] = [
  { id: 'arxiv', fields: [list('sources.arxiv.categories', 'arXiv categories', 'Like cs.CL')] },
  { id: 'biorxiv', fields: [list('sources.biorxiv.categories', 'bioRxiv categories', RXIV_HINT)] },
  { id: 'medrxiv', fields: [list('sources.medrxiv.categories', 'medRxiv categories', RXIV_HINT)] },
  { id: 'pubmed', fields: [text('sources.pubmed.query', 'PubMed query')] },
  { id: 'openalex' },
  { id: 'huggingface', note: 'Machine learning only' },
  { id: 'bluesky' },
  { id: 'alphaxiv', note: 'Unofficial: no public API, it can break without notice' },
];
const DIGEST_FIELDS: FieldDef[] = [
  { key: 'talked', label: 'People are talking about: up to (0–20)', type: 'number' },
  { key: 'inField', label: 'New in your field: up to (0–30)', type: 'number' },
  { key: 'minScore', label: 'Minimum score for your field (0–100)', type: 'number' },
  { key: 'maxAiCalls', label: 'AI calls per night (1–100)', type: 'number' },
  { key: 'paused', label: 'Pause the nightly digest', type: 'checkbox' },
];
const EMAIL_FIELDS: FieldDef[] = [
  { key: 'email.on', label: 'Email me the digest each morning', type: 'checkbox' },
  { ...text('email.to', 'To'), hint: 'Empty sends it to the email on your CV.' },
  {
    ...text('email.from', 'From'),
    hint: 'onboarding@resend.dev only delivers to your Resend account’s email until you verify a domain.',
  },
];
// `fields`: the error-key prefixes each section owns, for its error dot.
const SECTIONS = [
  { id: 'profile', label: 'Profile', fields: ['field', 'keywords', 'area'] },
  { id: 'sources', label: 'Sources', fields: ['sources'] },
  { id: 'digest', label: 'Digest', fields: ['talked', 'inField', 'minScore', 'maxAiCalls', 'paused', 'email'] },
];

function loaded(s: { prefs: ReadingPrefs; keys: Keys }) {
  prefs.value = s.prefs;
  keys.value = s.keys;
  saved.value = JSON.stringify(s.prefs);
}

/** Fills the profile and sources from the CV and research areas; nothing is saved until Save. */
async function suggest() {
  suggesting.value = true;
  try {
    const { prefs: s } = await api<{ prefs: ReadingPrefs }>('reading/suggest', { method: 'POST' });
    Object.assign(prefs.value!, { field: s.field, keywords: s.keywords, area: s.area, sources: s.sources });
    filled.value = true;
    suggestError.value = '';
  } catch (e) {
    suggestError.value = (e as Error).message;
  } finally {
    suggesting.value = false;
  }
}

// OpenAlex topics are picked by name; their ids are what the source reads.
const query = ref('');
const found = ref<Topic[] | null>(null);
const finding = ref(false);
const topicError = ref('');
async function findTopics() {
  finding.value = true;
  try {
    found.value = await api<Topic[]>(`reading/topics?q=${encodeURIComponent(query.value.trim())}`);
    topicError.value = '';
  } catch (e) {
    found.value = null;
    topicError.value = (e as Error).message;
  } finally {
    finding.value = false;
  }
}
const topics = () => prefs.value!.sources.openalex.topics;
function addTopic(t: Topic) {
  if (!topics().some((x) => x.id === t.id)) topics().push({ id: t.id, name: t.name });
}
const removeTopic = (id: string) => (prefs.value!.sources.openalex.topics = topics().filter((t) => t.id !== id));

async function save() {
  saving.value = true;
  errors.value = {};
  try {
    loaded(await api('reading/settings', { method: 'PUT', body: { prefs: prefs.value } }));
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
  try {
    loaded(await api('reading/settings'));
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/settings" title="Reading settings" :dirty="dirty">
    <template #actions>
      <button type="button" class="adm-btn adm-btn-primary" :disabled="saving || !prefs" @click="save">Save</button>
    </template>
    <AdminTabLinks
      label="Reading"
      :tabs="[
        { href: `${base}/reading`, label: 'Today' },
        { href: `${base}/reading/settings`, label: 'Settings', current: true },
      ]"
    />

    <template v-if="prefs">
      <p v-if="suggestError" class="adm-banner adm-banner-error" role="alert">
        {{ suggestError }}
        <a v-if="/ is not set/.test(suggestError)" :href="`${base}/ai#keys`">Add the key</a>
      </p>
      <p v-else-if="filled" class="adm-banner" role="status">Suggested from your profile. Review and save.</p>
      <AdminSections v-model="section" :sections="SECTIONS" :errors="errors">
        <template #profile>
          <div class="adm-actions">
            <button type="button" class="adm-btn adm-btn-small" :disabled="suggesting" @click="suggest">
              {{ suggesting ? 'Suggesting…' : 'Suggest from my profile' }}
            </button>
          </div>
          <FormFields :fields="PROFILE_FIELDS" :model="prefs" :errors="errors" />
        </template>

        <template #sources>
          <div class="adm-form">
            <div v-for="s in SOURCES" :key="s.id" class="adm-field">
              <label class="adm-check">
                <input v-model="prefs.sources[s.id].on" type="checkbox" />
                {{ SOURCE_NAMES[s.id] }}
              </label>
              <small v-if="s.note">{{ s.note }}</small>
              <FormFields v-if="s.fields" :fields="s.fields" :model="prefs" :errors="errors" />
              <template v-if="s.id === 'openalex'">
                <small v-if="keys && !keys.OPENALEX_API_KEY" role="note"
                  >Without a key, OpenAlex shares a small daily budget with everyone on this server's address, which can
                  run out on Vercel. Add OPENALEX_API_KEY under <a :href="`${base}/ai#keys`">Integrations</a>.</small
                >
                <ul v-if="prefs.sources.openalex.topics.length" class="adm-rows" aria-label="OpenAlex topics">
                  <li v-for="t in prefs.sources.openalex.topics" :key="t.id">
                    <span class="adm-row-main">{{ t.name }}</span>
                    <span class="adm-row-action">
                      <button
                        type="button"
                        class="adm-btn adm-btn-small"
                        :aria-label="`Remove ${t.name}`"
                        @click="removeTopic(t.id)"
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                </ul>
                <form class="adm-field" @submit.prevent="findTopics">
                  <label for="adm-topic-q">Find an OpenAlex topic</label>
                  <div class="adm-list-row">
                    <input id="adm-topic-q" v-model="query" type="search" />
                    <button type="submit" class="adm-btn" :disabled="finding || query.trim().length < 2">Find</button>
                  </div>
                </form>
                <span v-if="topicError" class="adm-err" role="alert">{{ topicError }}</span>
                <p v-else-if="found && !found.length" class="adm-muted" role="status">No topic matches.</p>
                <div v-else-if="found" class="adm-actions" role="group" aria-label="Matching topics">
                  <button
                    v-for="t in found"
                    :key="t.id"
                    type="button"
                    class="adm-btn adm-btn-small"
                    :disabled="prefs.sources.openalex.topics.some((x) => x.id === t.id)"
                    @click="addTopic(t)"
                  >
                    + {{ t.name }} ({{ t.level }})
                  </button>
                </div>
              </template>
            </div>
          </div>
        </template>

        <template #digest>
          <FormFields :fields="DIGEST_FIELDS" :model="prefs" :errors="errors" />
          <h2 class="adm-subhead">Email</h2>
          <p v-if="keys && !keys.RESEND_API_KEY" class="adm-banner" role="note">
            <span
              >Email uses the Resend key from
              <a :href="`${base}/career/settings#notifications`">Job search settings</a>.</span
            >
          </p>
          <FormFields :fields="EMAIL_FIELDS" :model="prefs" :errors="errors" />
        </template>
      </AdminSections>
    </template>
  </AdminShell>
</template>
