<script setup lang="ts">
import { getPath, hexToRgb, rgbToHex, setDesign, type DesignField, type FieldGroup } from '../lib/cv-design-fields';

/** `design` is edited in place; an empty field inherits (its placeholder shows what from). */
const props = defineProps<{ groups: FieldGroup[]; design: Record<string, unknown> }>();

const value = (f: DesignField) => getPath(props.design, f.path);
const str = (f: DesignField) => {
  const v = value(f);
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
};
const set = (f: DesignField, v: unknown) => setDesign(props.design, f.path, v);
const text = (e: Event) => (e.target as HTMLInputElement).value;
const inherited = (f: DesignField) => f.placeholder === 'true';
const checked = (f: DesignField) => (typeof value(f) === 'boolean' ? (value(f) as boolean) : inherited(f));
/** Back to the inherited value: drop the key, so a later theme or density change still applies. */
const setBool = (f: DesignField, on: boolean) => set(f, on === inherited(f) ? undefined : on);
const setList = (f: DesignField, s: string) =>
  set(
    f,
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
const swatch = (f: DesignField) => rgbToHex(str(f) || f.placeholder) ?? '#000000';
</script>

<template>
  <details v-for="(g, i) in groups" :key="g.group" class="adm-group adm-design-group" :open="i === 0">
    <summary>{{ g.group }}</summary>
    <div class="adm-form">
      <template v-for="f in g.fields" :key="f.path.join('.')">
        <label v-if="f.kind === 'boolean'" class="adm-check" :title="f.help">
          <input
            type="checkbox"
            :checked="checked(f)"
            @change="setBool(f, ($event.target as HTMLInputElement).checked)"
          />
          {{ f.label }}
        </label>
        <div v-else-if="f.kind === 'color'" class="adm-list-row adm-color-row">
          <label class="adm-field">
            <span>{{ f.label }}</span>
            <input
              type="text"
              :value="str(f)"
              :placeholder="f.placeholder"
              :title="f.help"
              @input="set(f, text($event))"
            />
          </label>
          <input
            type="color"
            :value="swatch(f)"
            :aria-label="`${f.label} picker`"
            @input="set(f, hexToRgb(text($event)))"
          />
        </div>
        <label v-else class="adm-field">
          <span>{{ f.label }}</span>
          <select v-if="f.kind === 'select'" :value="str(f)" :title="f.help" @change="set(f, text($event))">
            <option value="">Inherit ({{ f.placeholder }})</option>
            <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
            <option v-if="str(f) && !f.options?.includes(str(f))" :value="str(f)">{{ str(f) }} (not in list)</option>
          </select>
          <input
            v-else-if="f.kind === 'list'"
            type="text"
            :value="str(f)"
            :placeholder="f.placeholder"
            :title="f.help ? `${f.help} Comma-separated.` : 'Comma-separated.'"
            @change="setList(f, text($event))"
          />
          <input
            v-else
            type="text"
            :value="str(f)"
            :placeholder="f.placeholder"
            :title="f.help"
            @input="set(f, text($event))"
          />
        </label>
      </template>
    </div>
  </details>
</template>
