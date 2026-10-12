<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, committed, report, toast } from './api';
import { vDialog } from './dialog';
import type { AdminCtx } from './types';
import type { EditorStatus, PublishResult } from '../lib/admin/editor';

type Busy = '' | 'load' | 'start' | 'end' | 'over' | 'run' | 'discard' | 'publish';
type Confirm = 'publish' | 'discard' | 'over';

defineProps<{ ctx: AdminCtx }>();
const status = ref<EditorStatus | null>(null);
const busy = ref<Busy>('load');
const prompt = ref('');
const phone = ref(false);
const confirming = ref<Confirm | null>(null);
const message = ref('');
// Bumped when the preview's content changes under it (a run ended, a discard): the iframe reloads.
const previewKey = ref(0);
let poll: ReturnType<typeof setTimeout> | undefined;

const ready = computed(() => (status.value?.state === 'ready' ? status.value : null));
const running = computed(() => !!ready.value?.run?.running);
const reason = computed(() => {
  const s = status.value;
  if (!s) return '';
  if (s.state === 'unavailable') return s.reason;
  return s.state !== 'ready' && s.blocked ? s.blocked : '';
});
const refused = computed(() => ready.value?.files.filter((f) => !f.allowed) ?? []);
const line = computed(() => {
  if (busy.value === 'start' || busy.value === 'over')
    return 'Starting… The first start copies and installs the site, which takes about a minute.';
  const s = status.value;
  if (!s || s.state === 'unavailable') return '';
  if (s.state === 'none') return 'No session.';
  if (s.state === 'stopped') return 'Stopped. Start resumes it with its changes.';
  return running.value ? 'Running a change…' : 'Ready.';
});
const CONFIRM: Record<Confirm, { title: string; text: string; action: string }> = {
  publish: {
    title: 'Publish these changes?',
    text: 'They are committed to the deployed branch and the site redeploys in about a minute. Git history is the undo.',
    action: 'Publish',
  },
  discard: {
    title: 'Discard every change?',
    text: 'The files go back to how this session last published or started. This cannot be undone.',
    action: 'Discard changes',
  },
  over: {
    title: 'Start over?',
    text: 'This deletes the session, unpublished changes included, and starts again from a fresh copy of the live site.',
    action: 'Start over',
  },
};

function settle(next: EditorStatus) {
  const wasRunning = running.value;
  status.value = next;
  if (wasRunning && !running.value) previewKey.value++;
  clearTimeout(poll);
  if (running.value) poll = setTimeout(load, 2000);
}

async function load() {
  try {
    settle(await api<EditorStatus>('editor/session'));
  } catch (e) {
    report(e);
  } finally {
    if (busy.value === 'load') busy.value = '';
  }
}

async function act(kind: Busy, call: () => Promise<void>) {
  busy.value = kind;
  try {
    await call();
  } catch (e) {
    report(e);
  } finally {
    busy.value = '';
  }
}

const start = () => act('start', async () => settle(await api<EditorStatus>('editor/session', { method: 'POST' })));
const end = () => act('end', async () => settle(await api<EditorStatus>('editor/session', { method: 'DELETE' })));

const run = () =>
  act('run', async () => {
    await api('editor/runs', { body: { prompt: prompt.value } });
    prompt.value = '';
    await load();
  });

async function confirmed() {
  const kind = confirming.value;
  confirming.value = null;
  if (kind === 'discard') {
    await act('discard', async () => {
      settle(await api<EditorStatus>('editor/changes', { method: 'DELETE' }));
      previewKey.value++;
    });
  } else if (kind === 'over') {
    await act('over', async () => {
      settle(await api<EditorStatus>('editor/start-over', { method: 'POST' }));
      previewKey.value++;
    });
  } else if (kind === 'publish') {
    await act('publish', async () => {
      const r = await api<PublishResult>('editor/publish', { body: { message: message.value } });
      message.value = '';
      if (r.warning) committed({ url: r.commit?.url, warning: r.warning, tags: r.tags, detail: r.detail });
      else toast(r.commit ? 'Published · live in about a minute' : 'Published', r.commit?.url);
      await load();
    });
  }
}

onMounted(load);
onBeforeUnmount(() => clearTimeout(poll));
</script>

<template>
  <AdminShell :ctx="ctx" active="editor" title="Site editor">
    <template #actions>
      <template v-if="status && status.state !== 'unavailable'">
        <button
          v-if="status.state !== 'ready'"
          type="button"
          class="adm-btn adm-btn-primary"
          :disabled="!!busy || !!reason"
          @click="start"
        >
          {{ busy === 'start' ? 'Starting…' : 'Start session' }}
        </button>
        <button v-else type="button" class="adm-btn" :disabled="!!busy" @click="end">End session</button>
        <button
          v-if="status.state !== 'none'"
          type="button"
          class="adm-btn"
          :disabled="!!busy || running || !!status.blocked"
          @click="confirming = 'over'"
        >
          Start over
        </button>
      </template>
    </template>

    <p class="adm-muted">
      Describe a change to the site's design or pages. A coding agent makes it in a private copy of the site, you check
      it in the preview, and Publish commits it so the live site redeploys. Admin, sign-in, server code and dependencies
      are off limits.
    </p>

    <div v-if="reason" class="adm-banner adm-banner-error" role="alert">
      <span><strong>Not available.</strong> {{ reason }}</span>
    </div>

    <p v-if="line" class="adm-editor-line" role="status">
      {{ line }}
      <span v-if="ready" class="adm-muted"> · {{ ready.provider }} · {{ ready.model }}</span>
    </p>

    <template v-if="ready">
      <p v-if="ready.blocked" class="adm-banner adm-banner-error" role="alert">{{ ready.blocked }}</p>

      <form class="adm-form" @submit.prevent="run">
        <label class="adm-field">
          <span>What should change?</span>
          <textarea
            v-model="prompt"
            rows="4"
            placeholder="Make the header serif and move the news section above publications"
            :disabled="running || !!ready.blocked"
          />
        </label>
        <div class="adm-actions">
          <button
            type="submit"
            class="adm-btn adm-btn-primary"
            :disabled="!!busy || running || !prompt.trim() || !!ready.blocked"
          >
            {{ running ? 'Running…' : 'Run' }}
          </button>
        </div>
      </form>

      <section v-if="ready.run" class="adm-card" aria-labelledby="adm-editor-run">
        <h2 id="adm-editor-run" class="adm-h2">
          {{ ready.run.running ? 'Working on' : 'Last request' }}
        </h2>
        <p>{{ ready.run.prompt }}</p>
        <p v-if="!ready.run.running" :class="ready.run.exitCode === 0 ? 'adm-muted' : 'adm-err'">
          {{
            ready.run.exitCode === 0
              ? 'Finished.'
              : ready.run.exitCode === undefined
                ? 'Stopped before it finished.'
                : `The agent failed (exit code ${ready.run.exitCode}); its log is below.`
          }}
        </p>
        <pre class="adm-pre adm-editor-log" aria-label="Agent log">{{ ready.log || 'Waiting for output…' }}</pre>
      </section>

      <section class="adm-card" aria-labelledby="adm-editor-preview">
        <div class="adm-head">
          <h2 id="adm-editor-preview" class="adm-h2">Preview</h2>
          <div class="adm-actions">
            <button type="button" class="adm-btn adm-btn-small" :aria-pressed="!phone" @click="phone = false">
              Desktop
            </button>
            <button type="button" class="adm-btn adm-btn-small" :aria-pressed="phone" @click="phone = true">
              Phone
            </button>
            <a :href="ready.previewUrl" target="_blank" rel="noopener">Open ↗</a>
          </div>
        </div>
        <iframe
          :key="previewKey"
          :src="ready.previewUrl"
          title="Preview of the edited site"
          class="adm-editor-frame"
          :class="{ 'is-phone': phone }"
        />
      </section>

      <section class="adm-card" aria-labelledby="adm-editor-changes">
        <h2 id="adm-editor-changes" class="adm-h2">Changes</h2>
        <p v-if="!ready.files.length" class="adm-muted">No changes yet.</p>
        <ul v-else class="adm-editor-files">
          <li v-for="f in ready.files" :key="f.path" :class="{ 'adm-err': !f.allowed }">
            <code>{{ f.path }}</code> · {{ f.status }}<template v-if="f.binary"> · binary</template>
            <strong v-if="!f.allowed"> · refused: outside what the editor may change</strong>
          </li>
        </ul>
        <p v-if="refused.length" class="adm-err">
          Publish is blocked while refused files are changed: discard, then ask again without them.
        </p>
        <details v-if="ready.diff">
          <summary>Diff</summary>
          <pre class="adm-pre adm-editor-diff">{{ ready.diff }}</pre>
          <p v-if="ready.diffTruncated" class="adm-muted">The diff is longer than shown.</p>
        </details>
        <div class="adm-actions">
          <button
            type="button"
            class="adm-btn"
            :disabled="!!busy || running || !ready.files.length || !!ready.blocked"
            @click="confirming = 'discard'"
          >
            Discard changes
          </button>
          <button
            type="button"
            class="adm-btn adm-btn-primary"
            :disabled="!!busy || running || !ready.files.length || refused.length > 0 || !!ready.blocked"
            @click="confirming = 'publish'"
          >
            {{ busy === 'publish' ? 'Publishing…' : 'Publish' }}
          </button>
        </div>
        <p v-if="ready.published" class="adm-muted">
          Last published {{ new Date(ready.published.at).toLocaleString() }}:
          <a v-if="ready.published.url" :href="ready.published.url" target="_blank" rel="noopener">{{
            ready.published.id.slice(0, 7)
          }}</a>
          <template v-else>{{ ready.published.id.slice(0, 7) }}</template>
        </p>
      </section>
    </template>

    <div
      v-if="confirming"
      v-dialog
      class="adm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-editor-confirm"
      @keydown.esc="confirming = null"
    >
      <div>
        <h2 id="adm-editor-confirm" class="adm-h2">{{ CONFIRM[confirming].title }}</h2>
        <p>{{ CONFIRM[confirming].text }}</p>
        <label v-if="confirming === 'publish'" class="adm-field">
          <span>Commit message (optional)</span>
          <input v-model="message" type="text" placeholder="Site editor: your first request" />
        </label>
        <div class="adm-actions">
          <button
            type="button"
            class="adm-btn"
            :class="confirming === 'publish' ? 'adm-btn-primary' : 'adm-btn-danger'"
            @click="confirmed"
          >
            {{ CONFIRM[confirming].action }}
          </button>
          <button type="button" class="adm-btn" @click="confirming = null">Cancel</button>
        </div>
      </div>
    </div>
  </AdminShell>
</template>
