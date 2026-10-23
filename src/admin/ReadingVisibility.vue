<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, report } from './api';
import { visibilityText } from './vault';
import type { AdminCtx } from './types';
import type { Visibility } from '../lib/reading/visibility';

// The Visibility line with its toggle, and the warning a write's failed republish leaves (with Publish again).
// `send` makes the note public or private; the line updates from its answer, and a failure leaves it as it was.
const props = defineProps<{
  ctx: AdminCtx;
  kind: 'paper' | 'free';
  shared?: { on: number; all: number };
  send: (on: boolean) => Promise<{ visibility: Visibility; publishWarning?: string }>;
}>();
const visibility = defineModel<Visibility | null>('visibility', { required: true });
const warning = defineModel<string>('warning', { required: true });

/** The line cut around its public address and the Pages link. */
const line = computed(() => {
  const v = visibility.value;
  if (!v) return null;
  const t = visibilityText(v, props.kind, props.shared);
  const url = v.url ?? '';
  const at = url ? t.indexOf(url) : t.length;
  const end = t.endsWith(' Pages.') ? t.length - 'Pages.'.length : t.length;
  return { head: t.slice(0, at), url, mid: t.slice(at + url.length, end), pages: end < t.length };
});

const busy = ref(false);
async function toggle() {
  busy.value = true;
  try {
    const res = await props.send(!visibility.value!.public);
    visibility.value = res.visibility;
    warning.value = res.publishWarning ?? '';
  } catch (e) {
    report(e);
  } finally {
    busy.value = false;
  }
}

const publishing = ref(false);
async function publishAgain() {
  publishing.value = true;
  try {
    warning.value =
      (await api<{ publishWarning?: string }>('reading/vault/publish', { body: {} })).publishWarning ?? '';
  } catch (e) {
    report(e);
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <p v-if="line" class="adm-muted adm-vault-act">
    {{ line.head }}<a v-if="line.url" :href="line.url" target="_blank" rel="noopener">{{ line.url }}</a
    >{{ line.mid }}<template v-if="line.pages"><a :href="`/${ctx.adminPath}/pages`">Pages</a>.</template>
    <button v-if="!visibility!.chat" type="button" class="adm-btn" :disabled="busy" @click="toggle">
      {{ visibility!.public ? 'Make private' : 'Make public' }}
    </button>
  </p>
  <p v-if="warning" class="adm-err adm-vault-act" role="alert">
    Saved, but the public copy didn't update: {{ warning }}
    <button type="button" class="adm-btn" :disabled="publishing" @click="publishAgain">Publish again</button>
  </p>
</template>
