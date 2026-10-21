import presets from '../../services/cv-render/presets.json';
import type { Density } from './types';

/** services/cv-render/design-schema.json: RenderCV's design fields, plus each built-in theme's own defaults. */
export interface SchemaNode {
  type?: string;
  enum?: string[];
  default?: unknown;
  description?: string;
  format?: string;
  properties?: Record<string, SchemaNode>;
}
export interface DesignSchema {
  properties: Record<string, SchemaNode>;
  themeDefaults: Record<string, Record<string, unknown>>;
}

export type DesignKind = 'dimension' | 'color' | 'boolean' | 'select' | 'text' | 'list';
export interface DesignField {
  path: string[];
  label: string;
  kind: DesignKind;
  options?: string[];
  /** What the field resolves to when left empty: theme defaults, then the density preset. */
  placeholder: string;
  help?: string;
}
export interface FieldGroup {
  group: 'Page' | 'Text' | 'Colors' | 'Spacing';
  fields: DesignField[];
}

const GROUPS: [FieldGroup['group'], string[]][] = [
  ['Page', ['page']],
  ['Text', ['typography', 'links']],
  ['Colors', ['colors']],
  ['Spacing', ['header', 'section_titles', 'sections', 'entries']],
];

type Tree = Record<string, unknown>;
const isMap = (v: unknown): v is Tree => !!v && typeof v === 'object' && !Array.isArray(v);

/** `over` wins; maps merge, everything else (lists included) replaces. Same rule as cvrender.deep_merge. */
function deepMerge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isMap(v) && isMap(out[k]) ? deepMerge(out[k] as Tree, v) : v;
  return out;
}

function defaultsOf(props: Record<string, SchemaNode>): Tree {
  return Object.fromEntries(
    Object.entries(props).map(([k, n]) => [k, n.properties ? defaultsOf(n.properties) : n.default]),
  );
}

export function getPath(tree: unknown, path: string[]): unknown {
  return path.reduce<unknown>((v, k) => (isMap(v) ? v[k] : undefined), tree);
}

const display = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
const humanize = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function kindOf(n: SchemaNode): DesignKind {
  if (n.type === 'boolean') return 'boolean';
  if (n.enum) return 'select';
  if (n.format === 'color') return 'color';
  if (n.format === 'dimension') return 'dimension';
  return n.type === 'array' ? 'list' : 'text';
}

/** The design form for `theme` at `density`: every RenderCV field, grouped, with the value it inherits. */
export function designFields(schema: DesignSchema, theme: string, density: Density): FieldGroup[] {
  const preset = (presets as Record<string, Tree>)[density] ?? {};
  const effective = deepMerge(deepMerge(defaultsOf(schema.properties), schema.themeDefaults[theme] ?? {}), preset);
  return GROUPS.map(([group, roots]) => {
    const fields: DesignField[] = [];
    const walk = (n: SchemaNode, path: string[]) => {
      if (n.properties) return Object.entries(n.properties).forEach(([k, c]) => walk(c, [...path, k]));
      // A root of its own in a group of several ("Header › Space below name"); the group name says it otherwise.
      const shown = roots.length > 1 ? path : path.slice(1);
      fields.push({
        path,
        label: shown.map(humanize).join(' › '),
        kind: kindOf(n),
        ...(n.enum ? { options: n.enum } : {}),
        placeholder: display(getPath(effective, path)),
        ...(n.description ? { help: n.description } : {}),
      });
    };
    for (const root of roots) if (schema.properties[root]) walk(schema.properties[root], [root]);
    return { group, fields };
  });
}

/** Writes `value` at `path`, creating maps on the way; an empty value removes the key (inherit) and any map it empties. */
export function setDesign(design: Tree, path: string[], value: unknown): void {
  const key = path[path.length - 1];
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
    const parents: Tree[] = [design];
    for (const k of path.slice(0, -1)) {
      const next = parents[parents.length - 1][k];
      if (!isMap(next)) return;
      parents.push(next);
    }
    delete parents[parents.length - 1][key];
    for (let i = parents.length - 1; i > 0; i--)
      if (!Object.keys(parents[i]).length) delete parents[i - 1][path[i - 1]];
    return;
  }
  let node = design;
  for (const k of path.slice(0, -1)) {
    if (!isMap(node[k])) node[k] = {};
    node = node[k] as Tree;
  }
  node[key] = value;
}

const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
const HEX = /^#?([0-9a-f]{6})$/i;

/** `rgb(r, g, b)` or a hex color as `#rrggbb` for `<input type=color>`; null for names and HSL. */
export function rgbToHex(s: string): string | null {
  const hex = HEX.exec(s.trim());
  if (hex) return `#${hex[1].toLowerCase()}`;
  const m = RGB.exec(s.trim());
  if (!m || m.slice(1).some((c) => Number(c) > 255)) return null;
  return `#${m
    .slice(1)
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** `#rrggbb` → `rgb(r, g, b)`, the form RenderCV's own defaults use. */
export function hexToRgb(h: string): string {
  const n = parseInt(h.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
