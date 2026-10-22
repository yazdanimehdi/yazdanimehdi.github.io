<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- front matter is user data */
import { computed, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import AiAssist from './AiAssist.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import { ApiError, api, report, toast } from './api';
import { resolveOptions, setIn, type FieldDef, type Option } from './fields';
import { useDocument } from './useDocument';
import type { AdminCtx, CommitResult, Entry } from './types';
import { postStatus, suggestSlug } from '../lib/utils';

type Post = { data: Record<string, any>; body: string };

const props = defineProps<{ ctx: AdminCtx; slug: string }>();
const isNew = ref(props.slug === 'new');
const slug = ref(isNew.value ? '' : props.slug);
const preview = ref(false);
const publications = ref<Option[]>([]);
const doc = useDocument<Post>();

const SIDEBAR: FieldDef[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'tags', label: 'Tags', type: 'list' },
  { key: 'relatedPublication', label: 'Related publication', type: 'select', optionsFrom: 'publications' },
  { key: 'excerpt', label: 'Summary', type: 'textarea', hint: 'Shown in post lists and link previews.' },
  { key: 'coverImage', label: 'Cover image', type: 'image', folder: 'content' },
  { key: 'featured', label: 'Show on home page', type: 'checkbox' },
  {
    key: 'medium.url',
    label: 'Medium URL',
    type: 'text',
    hint: 'Set by "Also publish to Medium", or paste the link after importing.',
  },
];
const sidebar = computed(() => resolveOptions(SIDEBAR, { publications: publications.value }));
/** A future date: "Publish" schedules the post. */
const scheduled = computed(() => postStatus({ date: doc.current?.data.date }).startsWith('Scheduled'));
const suggested = computed(() => suggestSlug(String(doc.current?.data.title ?? '')));

const loadPost = (target: string) => async () => {
  const entry = await api<Post & { version: string; readonly: boolean }>(`collections/posts/${target}`);
  return { value: { data: entry.data, body: entry.body }, version: entry.version, readonly: entry.readonly };
};

onMounted(async () => {
  await doc.open(
    `posts/${props.slug}`,
    isNew.value
      ? async () => ({
          value: { data: { title: '', date: new Date().toISOString().slice(0, 10), draft: true }, body: '' },
          version: null,
        })
      : loadPost(props.slug),
  );
  api<Entry[]>('collections/publications').then((list) => {
    publications.value = list.map((p) => ({ value: p.slug, label: String(p.data.title ?? p.slug) }));
  }, report);
});

const alsoMedium = ref(false);
const importReady = ref(false);
// Only an http(s) link is rendered as one: a stored `javascript:` URL would run on click.
const onMedium = computed(() => {
  const url = String(doc.current?.data.medium?.url ?? '');
  return /^https?:\/\//i.test(url) ? url : '';
});

async function sendToMedium() {
  const target = slug.value;
  try {
    const result = await api<CommitResult & { medium: { id: string; url: string } }>(`posts/${target}/medium`, {
      method: 'POST',
      body: { version: doc.version },
    });
    if (doc.current) doc.current.data.medium = result.medium;
    doc.version = result.versions[`src/content/posts/${target}.md`] ?? doc.version;
    await doc.settle(); // the link is committed, not an unsaved edit
    toast('Sent to Medium as a draft', result.medium.url);
  } catch (e) {
    const url = e instanceof ApiError ? (e.details as { url?: string } | undefined)?.url : undefined;
    if (e instanceof ApiError && e.status === 409 && url) {
      await doc.reload(); // it is already linked: show the stored link
      return toast('Already on Medium', url);
    }
    if (e instanceof ApiError && e.status === 502 && url) {
      return toast(`${e.message}`, url); // sent, but not recorded: no Retry (it would make a second draft)
    }
    toast(`Published; Medium cross-post failed: ${e instanceof Error ? e.message : String(e)}`, undefined, {
      label: 'Retry',
      run: () => void sendToMedium(),
    });
  }
}

/**
 * No token: Medium's import tool copies the post and sets the canonical link to the URL it was given, so that is the
 * site's public URL (siteUrl), not this admin's host (a *.vercel.app or preview URL).
 */
async function importToMedium() {
  const url = `${(props.ctx.siteUrl || location.origin).replace(/\/$/, '')}/blog/${slug.value}/`;
  const live = 'once the post is live (git mode: about a minute after publishing; a scheduled post: on its date)';
  try {
    await navigator.clipboard.writeText(url);
    toast(`Post URL copied: paste it into Medium’s import box ${live}, then paste the result into "Medium URL"`);
  } catch {
    toast(`Paste this URL into Medium’s import box ${live}: ${url}`);
  }
  window.open('https://medium.com/p/import', '_blank', 'noopener');
}

async function save(draft: boolean) {
  if (!doc.current) return;
  const target = isNew.value ? slug.value || suggested.value : slug.value;
  if (!/^[a-z0-9-]{1,80}$/.test(target)) {
    toast('The slug needs 1–80 lowercase letters, digits or dashes');
    return;
  }
  const path = `src/content/posts/${target}.md`;
  const result = await doc.save(
    (post, version) =>
      api<CommitResult>(`collections/posts/${target}`, {
        method: 'PUT',
        body: { data: { ...post.data, draft }, body: post.body, version },
      }),
    path,
  );
  if (!result || !doc.current) return;
  doc.current.data.draft = draft; // only once saved: a failed save or a conflict leaves the flag as it was
  await doc.settle(); // the flag change above is already committed, not an unsaved edit
  if (isNew.value) {
    isNew.value = false;
    slug.value = target;
    doc.retarget(`posts/${target}`, loadPost(target));
    history.replaceState(null, '', `/${props.ctx.adminPath}/posts/${target}`);
  }
  if (!draft && alsoMedium.value && !onMedium.value && !scheduled.value) {
    alsoMedium.value = false;
    if (props.ctx.mediumToken) await sendToMedium();
    else importReady.value = true;
  }
}

function setSubtitle(e: Event) {
  if (doc.current) setIn(doc.current.data, 'subtitle', (e.target as HTMLInputElement).value);
}
</script>

<template>
  <AdminShell :ctx="ctx" active="posts" :title="isNew ? 'New post' : 'Edit post'" :dirty="doc.dirty">
    <template #actions>
      <button type="button" class="adm-btn" :aria-pressed="preview" @click="preview = !preview">
        {{ preview ? 'Edit' : 'Preview' }}
      </button>
      <button type="button" class="adm-btn" :disabled="doc.saving || doc.readonly" @click="save(true)">
        Save draft
      </button>
      <button type="button" class="adm-btn adm-btn-primary" :disabled="doc.saving || doc.readonly" @click="save(false)">
        {{ scheduled ? 'Schedule' : 'Publish' }}
      </button>
    </template>
    <template v-if="doc.current">
      <DocBanners
        :draft="!!doc.draft"
        :path="isNew ? undefined : `src/content/posts/${slug}.md`"
        :version="doc.version"
        :conflict="doc.conflict"
        :stale="doc.draftStale ? doc.draftChanges : null"
        @restore="doc.restore()"
        @discard="doc.discard()"
        @reload="doc.reload()"
      />
      <p v-if="doc.readonly" class="adm-banner">
        This post is MDX. The admin shows it read-only; edit it in the repository.
      </p>
      <div class="adm-split adm-split-wide">
        <div class="adm-form">
          <input
            v-model="doc.current.data.title"
            class="adm-title-input"
            type="text"
            placeholder="Title"
            aria-label="Title"
            :readonly="doc.readonly"
          />
          <span v-if="doc.errors.title" class="adm-err">{{ doc.errors.title }}</span>
          <input
            :value="doc.current.data.subtitle ?? ''"
            class="adm-subtitle-input"
            type="text"
            placeholder="Subtitle"
            aria-label="Subtitle"
            :readonly="doc.readonly"
            @input="setSubtitle"
          />
          <pre v-if="doc.readonly" class="adm-card adm-pre">{{ doc.current.body }}</pre>
          <MarkdownEditor v-else v-model="doc.current.body" :preview="preview" />
          <AiAssist
            v-if="!doc.readonly"
            collection="posts"
            :doc="doc.current"
            image-key="coverImage"
            @body="doc.current.body = $event"
          />
        </div>
        <aside class="adm-form" aria-label="Post settings">
          <label class="adm-field">
            <span>Slug (URL)</span>
            <input v-model="slug" type="text" :readonly="!isNew" :placeholder="suggested" />
            <small v-if="slug || suggested || !doc.current.data.title">/blog/{{ slug || suggested }}</small>
            <small v-else
              >Type a slug: lowercase letters, digits or dashes. The title has none to suggest one from.</small
            >
          </label>
          <fieldset class="adm-plain-fieldset" :disabled="doc.readonly">
            <FormFields :fields="sidebar" :model="doc.current.data" :errors="doc.errors" />
          </fieldset>
          <div class="adm-field">
            <a v-if="onMedium" :href="onMedium" target="_blank" rel="noopener">Already on Medium ↗</a>
            <label v-else-if="!scheduled" class="adm-check">
              <input v-model="alsoMedium" type="checkbox" :disabled="doc.readonly" />
              Also publish to Medium
            </label>
            <small v-else class="adm-muted">Medium cross-posting is available once the post is live.</small>
            <button v-if="importReady && !onMedium" type="button" class="adm-btn" @click="importToMedium">
              Import to Medium
            </button>
          </div>
        </aside>
      </div>
    </template>
  </AdminShell>
</template>
