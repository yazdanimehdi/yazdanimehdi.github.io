<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { api } from './api';
import type { AdminCtx } from './types';
import type { DraftFrom } from '../lib/reading/types';

// One per page. A failure shows the route's own sentence in place (missing key, cap, a refusal), with {{ }} only.
const props = defineProps<{ ctx: AdminCtx; from: DraftFrom | null; hint: string }>();
const busy = ref(false);
const error = ref('');
const button = ref<HTMLButtonElement | null>(null);

/** Drafts the post, then opens it in the blog editor; the page stays busy until it leaves. */
async function draft() {
  if (!props.from || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const { slug } = await api<{ slug: string }>('reading/draft', { body: props.from });
    location.href = `/${props.ctx.adminPath}/posts/${encodeURIComponent(slug)}`;
  } catch (e) {
    error.value = (e as Error).message;
    busy.value = false;
    await nextTick();
    button.value?.focus(); // disabling it while busy dropped focus to the page
  }
}
</script>

<template>
  <div class="adm-draft">
    <button
      ref="button"
      type="button"
      class="adm-btn"
      :disabled="!from || busy"
      :aria-busy="busy || undefined"
      aria-describedby="adm-draft-hint"
      @click="draft"
    >
      {{
        busy
          ? 'Drafting… (up to a minute)'
          : from && 'papers' in from && from.papers.length > 1
            ? 'Draft a roundup'
            : 'Draft a blog post'
      }}
    </button>
    <p id="adm-draft-hint" class="adm-hint">{{ hint }}</p>
    <p v-if="error" class="adm-err" role="alert">{{ error }}</p>
  </div>
</template>
