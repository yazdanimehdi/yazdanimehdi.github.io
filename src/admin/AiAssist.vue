<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- front matter is user data */
import { ref } from 'vue';
import { api, report, toast } from './api';
import { getIn, setIn } from './fields';

/** `doc` is the open document; AI results land in it as unsaved edits, so nothing is committed until the owner saves. */
const props = defineProps<{
  collection: 'posts' | 'announcements' | 'publications';
  doc: { data: Record<string, any>; body: string };
  imageKey: 'coverImage' | 'image';
  disabled?: boolean;
}>();
/** The new Markdown body; the parent owns `doc.body`. */
const emit = defineEmits<{ body: [value: string] }>();

/** Publications get a figure only: their body is not written by AI. */
const writes = props.collection !== 'publications';
const instruction = ref('');
const busy = ref<'' | 'write' | 'rewrite' | 'image' | 'motion'>('');
/** The body and image from before the last AI change. */
const before = ref<{ body: string; image: unknown } | null>(null);

const remember = () => (before.value = { body: props.doc.body, image: getIn(props.doc.data, props.imageKey) });

async function run(action: 'write' | 'rewrite') {
  busy.value = action;
  try {
    const { text } = await api<{ text: string }>('ai/text', {
      body: {
        action,
        collection: props.collection,
        instruction: instruction.value,
        title: props.doc.data.title,
        subtitle: props.doc.data.subtitle,
        body: props.doc.body,
      },
    });
    remember();
    emit('body', text);
    toast(`${action === 'write' ? 'Draft written' : 'Rewritten'}: review it, then save`);
  } catch (e) {
    report(e);
  } finally {
    busy.value = '';
  }
}

async function image(motion: boolean) {
  busy.value = motion ? 'motion' : 'image';
  try {
    const { url } = await api<{ url: string }>('ai/image', {
      body: {
        collection: props.collection,
        title: props.doc.data.title,
        excerpt: props.doc.data.excerpt,
        abstract: props.doc.data.abstract,
        motion,
      },
    });
    remember();
    setIn(props.doc.data, props.imageKey, url);
    toast(
      motion
        ? 'Animation generated and saved to the media library as an animated WebP: review it, then save'
        : 'Image generated and added to the media library: review it, then save',
    );
  } catch (e) {
    report(e);
  } finally {
    busy.value = '';
  }
}

function undo() {
  if (!before.value) return;
  emit('body', before.value.body);
  setIn(props.doc.data, props.imageKey, before.value.image);
  before.value = null;
}
</script>

<template>
  <fieldset class="adm-group" :disabled="disabled || !!busy">
    <legend>AI assist</legend>
    <label v-if="writes" class="adm-field">
      <span>Instruction (optional)</span>
      <textarea v-model="instruction" rows="2" placeholder="e.g. a friendly 300-word summary for non-specialists" />
    </label>
    <div class="adm-actions">
      <template v-if="writes">
        <button type="button" class="adm-btn adm-btn-small" @click="run('write')">
          {{ busy === 'write' ? 'Writing…' : 'Write' }}
        </button>
        <button type="button" class="adm-btn adm-btn-small" @click="run('rewrite')">
          {{ busy === 'rewrite' ? 'Rewriting…' : 'Rewrite' }}
        </button>
      </template>
      <button type="button" class="adm-btn adm-btn-small" @click="image(false)">
        {{ busy === 'image' ? 'Generating…' : 'Generate image' }}
      </button>
      <button type="button" class="adm-btn adm-btn-small" @click="image(true)">
        {{ busy === 'motion' ? 'Animating… (1–3 min)' : 'Generate GIF' }}
      </button>
      <button v-if="before" type="button" class="adm-btn adm-btn-small" @click="undo">Undo</button>
    </div>
  </fieldset>
</template>
