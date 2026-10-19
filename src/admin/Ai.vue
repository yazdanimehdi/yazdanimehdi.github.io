<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- config files are user data */
import { computed, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import { api, report, toast } from './api';
import { text, type FieldDef } from './fields';
import { useDocument } from './useDocument';
import type { AdminCtx, CommitResult } from './types';
import { DEFAULT_MODELS, IMAGE_PROVIDERS, TEXT_PROVIDERS, resolveAiConfig } from '../lib/ai/providers';
import type { PapersResult } from '../lib/admin/papers';
import type { SecretStatus } from '../lib/admin/secrets';

type Config = Record<string, any>;
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const editable = props.ctx.mode === 'postgres';

const keys = ref<SecretStatus[]>([]);
const typed = ref<Record<string, string>>({});
const savingKey = ref('');
const ai = useDocument<Config>();
const scholar = useDocument<Config>();
const checking = ref(false);
const checked = ref<PapersResult | null>(null);
const lastRun = ref<string | null>(null);

const options = (providers: Record<string, { label: string }>) =>
  Object.entries(providers).map(([value, p]) => ({ value, label: p.label }));
const AI_FIELDS = computed<FieldDef[]>(() => {
  const effective = resolveAiConfig(ai.current);
  return [
    { key: 'text.provider', label: 'Writing provider', type: 'select', options: options(TEXT_PROVIDERS) },
    {
      key: 'text.model',
      label: 'Writing model',
      type: 'text',
      hint: `Empty uses ${DEFAULT_MODELS.text[effective.text.provider]}.`,
    },
    { key: 'image.provider', label: 'Image provider', type: 'select', options: options(IMAGE_PROVIDERS) },
    {
      key: 'image.model',
      label: 'Image model',
      type: 'text',
      hint: `Empty uses ${DEFAULT_MODELS.image[effective.image.provider]}.`,
    },
    { key: 'papers.autoPost', label: 'Write a draft post for each new paper', type: 'checkbox', default: true },
    {
      key: 'papers.maxPostsPerRun',
      label: 'Posts per run',
      type: 'number',
      hint: 'Each post costs a writing and an image call. More new papers wait for the next run.',
    },
  ];
});
const SCHOLAR_FIELDS: FieldDef[] = [
  {
    key: 'authors',
    label: 'Google Scholar authors',
    type: 'objects',
    fields: [text('name', 'Name'), text('scholar_id', 'Scholar author id (the user= value in the profile URL)')],
  },
];

function status(k: SecretStatus): string {
  if (k.source === 'admin') return `Set in admin · …${k.last4}`;
  if (k.source === 'env') return 'From environment';
  return 'Not set';
}

async function loadKeys() {
  try {
    keys.value = await api<SecretStatus[]>('ai/keys');
  } catch (e) {
    report(e);
  }
}

async function saveKey(name: string, value: string | null) {
  savingKey.value = name;
  try {
    keys.value = await api<SecretStatus[]>('ai/keys', { method: 'PUT', body: { name, value } });
    typed.value[name] = '';
    toast(value ? 'Key saved' : 'Key cleared');
  } catch (e) {
    report(e);
  } finally {
    savingKey.value = '';
  }
}

const loader = (file: string) => async () => {
  const { data, version } = await api<{ data: Config; version: string | null }>(`config/${file}`);
  return { value: data, version };
};
const publish = (doc: typeof ai, file: string) =>
  doc.save(
    (data, version) => api<CommitResult>(`config/${file}`, { method: 'PUT', body: { data, version } }),
    `config/${file}.yml`,
  );

async function checkNow() {
  checking.value = true;
  try {
    checked.value = await api<PapersResult>('papers/sync', { method: 'POST' });
    if (checked.value.skipped) toast(`Nothing checked: ${checked.value.skipped}`);
    lastRun.value = (await api<{ lastRun: string | null }>('papers/sync')).lastRun;
  } catch (e) {
    report(e);
  } finally {
    checking.value = false;
  }
}

onMounted(() => {
  loadKeys();
  ai.open('config/ai', loader('ai'));
  scholar.open('config/scholar', loader('scholar'));
  api<{ lastRun: string | null }>('papers/sync').then((r) => (lastRun.value = r.lastRun), report);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="ai" title="Scholar & AI">
    <section id="keys" class="adm-form" aria-labelledby="adm-keys">
      <h2 id="adm-keys" class="adm-h2">API keys</h2>
      <p class="adm-muted">
        <template v-if="editable">
          Keys typed here are stored encrypted in the database. Without one, the environment variable of the same name
          is used.
        </template>
        <template v-else>
          Git mode has no database: set each key as an environment variable in Vercel (Settings → Environment
          Variables), then redeploy.
        </template>
      </p>
      <table class="adm-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Status</th>
            <th v-if="editable"><span class="adm-visually-hidden">Change</span></th>
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
            <td v-if="editable">
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

    <fieldset class="adm-group">
      <legend>Writing and images</legend>
      <DocBanners
        :draft="!!ai.draft"
        :path="'config/ai.yml'"
        :version="ai.version"
        :conflict="ai.conflict"
        :stale="ai.draftStale ? ai.draftChanges : null"
        @restore="ai.restore()"
        @discard="ai.discard()"
        @reload="ai.reload()"
      />
      <p class="adm-muted">
        Write, Rewrite and Generate image in the post and news editors send the title, subtitle, summary, instruction
        and body to the provider chosen here. Saved to config/ai.yml.
      </p>
      <FormFields v-if="ai.current" :fields="AI_FIELDS" :model="ai.current" :errors="ai.errors" />
      <div class="adm-actions">
        <button type="button" class="adm-btn" :disabled="ai.saving || !ai.current" @click="publish(ai, 'ai')">
          Publish AI settings
        </button>
      </div>
    </fieldset>

    <fieldset id="scholar" class="adm-group">
      <legend>Papers from Google Scholar</legend>
      <DocBanners
        :draft="!!scholar.draft"
        :path="'config/scholar.yml'"
        :version="scholar.version"
        :conflict="scholar.conflict"
        :stale="scholar.draftStale ? scholar.draftChanges : null"
        @restore="scholar.restore()"
        @discard="scholar.discard()"
        @reload="scholar.reload()"
      />
      <p class="adm-muted">
        New papers on these profiles (through SerpApi) become publications and, per the settings above, draft posts to
        review. {{ editable ? 'Checked daily, or now:' : 'Check now, or let the weekly GitHub Action sync them.' }}
      </p>
      <FormFields v-if="scholar.current" :fields="SCHOLAR_FIELDS" :model="scholar.current" :errors="scholar.errors" />
      <div class="adm-actions">
        <button
          type="button"
          class="adm-btn"
          :disabled="scholar.saving || !scholar.current"
          @click="publish(scholar, 'scholar')"
        >
          Publish authors
        </button>
        <button type="button" class="adm-btn adm-btn-primary" :disabled="checking" @click="checkNow">
          {{ checking ? 'Checking…' : 'Check now' }}
        </button>
      </div>
      <p class="adm-muted">Last new papers: {{ lastRun ? new Date(lastRun).toLocaleString() : 'none yet' }}</p>
      <div v-if="checked && !checked.skipped" class="adm-card" role="status">
        <p>
          Imported {{ checked.imported.length }} · drafted {{ checked.posts.length }}
          <template v-if="checked.deferred.length"> · {{ checked.deferred.length }} left for the next run</template>
          <template v-if="checked.failed.length"> · {{ checked.failed.length }} failed</template>
        </p>
        <ul v-if="checked.posts.length">
          <li v-for="slug in checked.posts" :key="slug">
            <a :href="`${base}/posts/${slug}`">{{ slug }}</a> (draft)
          </li>
        </ul>
        <ul v-if="checked.failed.length">
          <li v-for="f in checked.failed" :key="f.item" class="adm-err">{{ f.item }}: {{ f.error }}</li>
        </ul>
      </div>
    </fieldset>
  </AdminShell>
</template>
