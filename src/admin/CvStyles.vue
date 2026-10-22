<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import { parse, stringify } from 'yaml';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import DesignForm from './DesignForm.vue';
import DocBanners from './DocBanners.vue';
import { api, committed, report, toast } from './api';
import { useDocument } from './useDocument';
import schema from '../../services/cv-render/design-schema.json';
import { designFields } from '../lib/cv-design-fields';
import type { CvStyle, CvStylesConfig, Density } from '../lib/types';
import type { AdminCtx, CommitResult } from './types';

defineProps<{ ctx: AdminCtx }>();
const doc = useDocument<CvStylesConfig>();
const builtIn = ref<string[]>([]);
const themes = ref<string[]>([]);
const selectedId = ref('');
const confirmDelete = ref(false);
const confirmTheme = ref('');
const DENSITIES: [Density, string][] = [
  ['compact', 'Compact'],
  ['normal', 'Normal'],
  ['airy', 'Airy'],
];

const styles = computed(() => doc.current?.styles ?? []);
const style = computed(() => styles.value.find((s) => s.id === selectedId.value));
const groups = computed(() => (style.value ? designFields(schema, style.value.theme, style.value.density) : []));
const LABELS: Record<string, string> = {
  engineeringresumes: 'Engineering resumes',
  engineeringclassic: 'Engineering classic',
  moderncv: 'ModernCV',
};
const label = (theme: string) => LABELS[theme] ?? theme[0].toUpperCase() + theme.slice(1);

onMounted(() => {
  void doc.open('config/cv-styles', async () => {
    const res = await api<{
      data: CvStylesConfig;
      version: string | null;
      builtIn: string[];
      themes: string[];
    }>('cv/styles');
    builtIn.value = res.builtIn;
    themes.value = res.themes;
    return { value: res.data, version: res.version };
  });
});

// ── The style list ──
function select(id: string) {
  selectedId.value = id;
  confirmDelete.value = false;
}
/** A style id (STYLE_ID in cv-styles.ts) from its name, unique among the styles. */
function newId(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'style';
  let id = base;
  for (let n = 2; styles.value.some((s) => s.id === id); n++) id = `${base}-${n}`;
  return id;
}
function add(from: Omit<CvStyle, 'id' | 'name'>, suggested: string) {
  const name = window.prompt('Style name', suggested)?.trim();
  if (!name || !doc.current) return;
  const id = newId(name);
  doc.current.styles.push({ ...structuredClone(toRaw(from)), id, name });
  select(id);
}
const useTheme = (theme: string) => add({ theme, density: 'normal', design: {} }, label(theme));
const duplicate = () => style.value && add(style.value, `${style.value.name} copy`);
function rename() {
  const name = style.value && window.prompt('Style name', style.value.name)?.trim();
  if (name && style.value) style.value.name = name;
}
function remove() {
  if (!doc.current || !style.value || styles.value.length < 2) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  doc.current.styles = styles.value.filter((s) => s.id !== selectedId.value);
  if (doc.current.public === selectedId.value) doc.current.public = doc.current.styles[0].id;
  select(doc.current.public);
}
function setPublic() {
  if (doc.current && style.value) doc.current.public = style.value.id;
}

async function save() {
  await doc.save(
    (data, version) => api<CommitResult>('config/cv-styles', { method: 'PUT', body: { data, version } }),
    'config/cv-styles.yml',
  );
}
// Opening, a reload or a restored draft can leave no style selected: select the public one.
watch(styles, () => {
  if (doc.current && !style.value) select(doc.current.public);
});

// ── Custom themes (publishers only: their templates run inside the renderer) ──
async function uploadTheme(e: Event) {
  const input = e.target as HTMLInputElement;
  const picked = [...(input.files ?? [])];
  input.value = '';
  if (!picked.length) return;
  const folder = picked[0]?.webkitRelativePath.split('/')[0] ?? '';
  const name = window.prompt(
    'Theme name (lowercase letters and digits)',
    folder.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  if (!name) return;
  const typ = picked.filter((f) => f.name.endsWith('.typ'));
  if (!typ.length) return toast('That folder has no .typ template files');
  const files = Object.fromEntries(
    await Promise.all(typ.map(async (f) => [f.webkitRelativePath.split('/').slice(1).join('/'), await f.text()])),
  );
  try {
    committed(await api<CommitResult>(`cv/themes/${encodeURIComponent(name)}`, { method: 'PUT', body: { files } }));
    if (!themes.value.includes(name)) themes.value.push(name);
    preview();
  } catch (err) {
    report(err);
  }
}
async function deleteTheme(name: string) {
  if (confirmTheme.value !== name) {
    confirmTheme.value = name;
    return;
  }
  confirmTheme.value = '';
  try {
    committed(await api<CommitResult>(`cv/themes/${encodeURIComponent(name)}`, { method: 'DELETE' }));
    themes.value = themes.value.filter((t) => t !== name);
  } catch (err) {
    report(err);
  }
}

// ── Advanced: the raw design YAML, kept in step with the form ──
const yamlText = ref('');
const yamlError = ref('');
const sameDesign = (text: string, design: unknown) => {
  try {
    return JSON.stringify(parse(text) ?? {}) === JSON.stringify(design);
  } catch {
    return false;
  }
};
watch(
  () => style.value?.design,
  (design) => {
    if (!design || sameDesign(yamlText.value, design)) return;
    yamlText.value = Object.keys(design).length ? stringify(design) : '';
    yamlError.value = '';
  },
  { deep: true, immediate: true },
);
function editYaml(text: string) {
  yamlText.value = text;
  try {
    const design = parse(text) ?? {};
    if (typeof design !== 'object' || Array.isArray(design)) throw new Error('The design is a map of RenderCV keys');
    yamlError.value = '';
    if (style.value) style.value.design = design;
  } catch (e) {
    yamlError.value = (e as Error).message.split('\n')[0];
  }
}

// ── Live preview: RenderCV renders the unsaved style; a failed render keeps that style's last good PDF ──
/** The last PDF and the style it shows: another style's PDF is never shown (or downloaded) as this one's. */
const pdf = ref<{ url: string; styleId: string } | null>(null);
const pdfUrl = computed(() => (pdf.value?.styleId === selectedId.value ? pdf.value.url : ''));
const renderError = ref('');
const rendering = ref(false);
let timer: number | undefined;
let inFlight: AbortController | null = null;
let previewedId = '';
/** Edits wait 800 ms for the next keystroke; switching styles renders at once. Either way older requests stop now. */
function preview() {
  const switched = selectedId.value !== previewedId;
  previewedId = selectedId.value;
  if (switched) renderError.value = '';
  clearTimeout(timer);
  inFlight?.abort();
  timer = window.setTimeout(render, switched ? 0 : 800);
}
async function render() {
  if (!style.value) return;
  const styleId = style.value.id;
  const ctrl = (inFlight = new AbortController());
  rendering.value = true;
  try {
    // Plain fetch, not api(): a renderer outage is this panel's error, not the admin-wide outage banner.
    const res = await fetch('/api/admin/cv/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: style.value }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      renderError.value = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? res.statusText;
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (pdf.value) URL.revokeObjectURL(pdf.value.url);
    pdf.value = { url, styleId };
    renderError.value = '';
  } catch (e) {
    if ((e as Error).name !== 'AbortError') renderError.value = (e as Error).message;
  } finally {
    if (inFlight === ctrl) {
      inFlight = null;
      rendering.value = false;
    }
  }
}
watch(() => JSON.stringify(style.value ?? null), preview);
onBeforeUnmount(() => {
  clearTimeout(timer);
  inFlight?.abort();
  if (pdf.value) URL.revokeObjectURL(pdf.value.url);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="cv-styles" title="CV" :dirty="doc.dirty">
    <template #actions>
      <button type="button" class="adm-btn adm-btn-primary" :disabled="doc.saving || !doc.current" @click="save">
        Publish styles
      </button>
    </template>
    <AdminTabLinks
      label="CV"
      :tabs="[
        { href: `/${ctx.adminPath}/cv`, label: 'Entries' },
        { href: `/${ctx.adminPath}/cv-styles`, label: 'Styles', current: true },
      ]"
    />
    <DocBanners
      :draft="!!doc.draft"
      :path="'config/cv-styles.yml'"
      :version="doc.version"
      :conflict="doc.conflict"
      :stale="doc.draftStale ? doc.draftChanges : null"
      @restore="doc.restore()"
      @discard="doc.discard()"
      @reload="doc.reload()"
    />

    <div v-if="doc.current" class="adm-styles">
      <section aria-labelledby="adm-my-styles" class="adm-form">
        <h2 id="adm-my-styles" class="adm-nav-label">My styles</h2>
        <ul class="adm-pick">
          <li v-for="s in styles" :key="s.id">
            <button type="button" :aria-current="s.id === selectedId" @click="select(s.id)">
              <span>{{ s.name }}</span>
              <span v-if="s.id === doc.current.public" class="adm-muted">Public</span>
            </button>
          </li>
        </ul>
        <div v-if="style" class="adm-actions">
          <button type="button" class="adm-btn adm-btn-small" @click="rename">Rename</button>
          <button type="button" class="adm-btn adm-btn-small" @click="duplicate">Duplicate</button>
          <button
            type="button"
            class="adm-btn adm-btn-small adm-btn-danger"
            :disabled="styles.length < 2"
            @click="remove"
          >
            {{ confirmDelete ? 'Click again to delete' : 'Delete' }}
          </button>
        </div>

        <h2 id="adm-built-in" class="adm-nav-label">Built-in themes</h2>
        <ul class="adm-pick" aria-labelledby="adm-built-in">
          <li v-for="t in builtIn" :key="t">
            <button type="button" :aria-label="`Use ${label(t)} as a new style`" @click="useTheme(t)">
              <span>{{ label(t) }}</span
              ><span class="adm-muted">+ New</span>
            </button>
          </li>
        </ul>

        <template v-if="themes.length || ctx.canPublish">
          <h2 id="adm-uploaded" class="adm-nav-label">Uploaded themes</h2>
          <ul v-if="themes.length" class="adm-pick" aria-labelledby="adm-uploaded">
            <li v-for="t in themes" :key="t" class="adm-list-row">
              <button type="button" :aria-label="`Use ${t} as a new style`" @click="useTheme(t)">
                <span>{{ t }}</span
                ><span class="adm-muted">+ New</span>
              </button>
              <button
                v-if="ctx.canPublish"
                type="button"
                class="adm-btn adm-btn-small adm-btn-danger"
                :aria-label="confirmTheme === t ? `Click again to delete ${t}` : `Delete theme ${t}`"
                @click="deleteTheme(t)"
              >
                {{ confirmTheme === t ? 'Confirm' : 'Delete' }}
              </button>
            </li>
          </ul>
          <label v-if="ctx.canPublish" class="adm-field">
            <span>Upload theme</span>
            <input type="file" webkitdirectory multiple @change="uploadTheme" />
            <small>A folder of RenderCV Typst templates (*.j2.typ). Uploading the same name replaces it.</small>
          </label>
        </template>
      </section>

      <section v-if="style" aria-label="Style settings" class="adm-form">
        <label class="adm-field">
          <span>Theme</span>
          <select v-model="style.theme">
            <option v-for="t in builtIn" :key="t" :value="t">{{ label(t) }}</option>
            <option v-for="t in themes" :key="t" :value="t">{{ t }} (uploaded)</option>
            <option v-if="![...builtIn, ...themes].includes(style.theme)" :value="style.theme">
              {{ style.theme }} (missing)
            </option>
          </select>
        </label>
        <div class="adm-actions" role="group" aria-label="Density">
          <button
            v-for="[d, name] in DENSITIES"
            :key="d"
            type="button"
            class="adm-btn adm-btn-small"
            :aria-pressed="style.density === d"
            @click="style.density = d"
          >
            {{ name }}
          </button>
        </div>
        <p class="adm-muted">Empty fields inherit the theme and density shown in grey.</p>
        <DesignForm :groups="groups" :design="style.design" />
        <details class="adm-group adm-design-group">
          <summary>Advanced</summary>
          <label class="adm-field">
            <span>Design YAML (RenderCV <code>design</code> keys)</span>
            <textarea
              :value="yamlText"
              rows="12"
              spellcheck="false"
              :aria-invalid="!!yamlError || undefined"
              @input="editYaml(($event.target as HTMLTextAreaElement).value)"
            />
            <span v-if="yamlError" class="adm-err">{{ yamlError }}</span>
          </label>
        </details>
      </section>

      <section v-if="style" aria-label="Preview" class="adm-form adm-styles-preview">
        <div class="adm-actions">
          <button
            type="button"
            class="adm-btn adm-btn-small"
            :aria-pressed="style.id === doc.current.public"
            @click="setPublic"
          >
            Set as public download
          </button>
          <a v-if="pdfUrl" class="adm-btn adm-btn-small" :href="pdfUrl" :download="`${style.id}.pdf`">Download PDF</a>
          <span v-if="rendering" class="adm-muted" role="status">Rendering…</span>
        </div>
        <!-- RenderCV's validation errors are a box-drawn table: keep its columns. -->
        <pre v-if="renderError" class="adm-banner adm-banner-error adm-styles-error" role="alert">{{
          renderError
        }}</pre>
        <iframe v-if="pdfUrl" :src="pdfUrl" title="CV preview" />
        <p v-else-if="!rendering && !renderError" class="adm-muted">The preview appears here.</p>
      </section>
    </div>
  </AdminShell>
</template>
