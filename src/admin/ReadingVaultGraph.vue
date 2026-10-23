<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import { api, report } from './api';
import { visible } from './career';
import { plural } from './status';
import { KIND_NAMES, layout, nearestNode } from './vault';
import type { AdminCtx } from './types';
import type { NoteRow } from '../lib/reading/types';

// Titles may come from a paper's title: shown with {{ }} and attributes only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const open = (id: number) => `${base}/reading/vault/${id}`;

type GraphNode = NoteRow & { links: number };
const W = 1000;
const LABELS = 15;
const PICK = 24; // CSS px

const nodes = ref<GraphNode[] | null>(null);
const edges = ref<[number, number][]>([]); // node indexes
const total = ref(0);
const pts = ref<{ x: number; y: number }[]>([]);
const narrow = ref(false);
const h = computed(() => (narrow.value ? 1000 : 625));
const selected = ref<number | null>(null);

const kindName = (n: GraphNode) => KIND_NAMES[n.kind].toLowerCase();
/** Node indexes, by title, so Tab walks titles alphabetically. */
const byTitle = computed(() =>
  (nodes.value ?? []).map((_, i) => i).sort((a, b) => nodes.value![a].title.localeCompare(nodes.value![b].title)),
);
// A phone draws 1000 units in ~360 px: nodes 2.5× bigger stay ~9–20 px across.
const radius = (n: GraphNode) => (5 + Math.min(n.links, 10) * 0.6) * (narrow.value ? 2.5 : 1);
const neighbours = computed(() => {
  const s = selected.value;
  const out = new Set<number>();
  if (s === null) return out;
  for (const [a, b] of edges.value) {
    if (a === s) out.add(b);
    else if (b === s) out.add(a);
  }
  return out;
});
/**
 * The most-linked (the API's order; 5 on a phone) until a node is selected, then it and its neighbours only. A label
 * that would overlap one already placed is left out (the strip names every neighbour).
 */
const labelled = computed(() => {
  const s = selected.value;
  const top = s !== null ? 0 : narrow.value ? 5 : LABELS;
  const want = s === null ? [] : [s, ...[...neighbours.value].sort((a, b) => a - b)];
  want.push(...(nodes.value ?? []).slice(0, top).map((_, i) => i));
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  return want.filter((i) => {
    const at = labelAt(i);
    const wide = label(i).length * fontSize.value * 0.55;
    const x0 = at.anchor === 'end' ? at.x - wide : at.x;
    const b = { x0, x1: x0 + wide, y0: at.y - fontSize.value, y1: at.y + fontSize.value * 0.3 };
    if (placed.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) return false;
    placed.push(b);
    return true;
  });
});
const fontSize = computed(() => (narrow.value ? 30 : 13));
function label(i: number) {
  const t = visible(nodes.value![i].title);
  const max = narrow.value ? 22 : 32;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
function labelAt(i: number) {
  const p = pts.value[i];
  const r = radius(nodes.value![i]) + 4;
  const left = p.x > W / 2;
  return { x: left ? p.x - r : p.x + r, y: p.y + fontSize.value / 3, anchor: left ? 'end' : 'start' };
}
function diamond(i: number) {
  const { x, y } = pts.value[i];
  const r = radius(nodes.value![i]) * 1.25;
  return `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
}
const neighbourRows = computed(() =>
  [...neighbours.value].map((i) => nodes.value![i]).sort((a, b) => a.title.localeCompare(b.title)),
);

const svg = ref<SVGSVGElement | null>(null);
/** A tap or click off a node: the nearest node within 24 CSS px, or nothing. */
function pick(e: MouseEvent) {
  if ((e.target as Element).closest('a')) return;
  const m = svg.value?.getScreenCTM();
  if (!m) return;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  selected.value = nearestNode(pts.value, p.x, p.y, PICK / m.a);
}

onMounted(async () => {
  try {
    const g = await api<{ nodes: GraphNode[]; edges: [number, number][]; total: number }>('reading/vault/graph');
    const index = new Map(g.nodes.map((n, i) => [n.id, i]));
    const kept = g.edges.flatMap(([a, b]): [number, number][] => {
      const [i, j] = [index.get(a), index.get(b)];
      return i === undefined || j === undefined ? [] : [[i, j]];
    });
    narrow.value = matchMedia('(max-width: 639.98px)').matches;
    // room for the phone's bigger nodes inside the layout's margin
    const pad = narrow.value ? 16 : 0;
    pts.value = layout(g.nodes.length, kept, W - 2 * pad, h.value - 2 * pad).map((p) => ({
      x: p.x + pad,
      y: p.y + pad,
    }));
    edges.value = kept;
    total.value = g.total;
    nodes.value = g.nodes;
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/vault" title="Graph">
    <AdminTabLinks
      label="Reading"
      :tabs="[
        { href: `${base}/reading`, label: 'Today' },
        { href: `${base}/reading/library`, label: 'Library' },
        { href: `${base}/reading/notebooks`, label: 'Notebooks' },
        { href: `${base}/reading/vault`, label: 'Vault', current: true },
        { href: `${base}/reading/settings`, label: 'Settings' },
      ]"
    />
    <p><a :href="`${base}/reading/vault`">← Vault</a></p>

    <p v-if="!nodes" class="adm-muted">Loading…</p>
    <template v-else>
      <p>
        <template v-if="!edges.length">No links yet. Link notes with [[ ]] and they show here.</template>
        <template v-else>{{ plural(nodes.length, 'note') }}, {{ plural(edges.length, 'link') }}.</template>
        <template v-if="total > nodes.length">
          Showing the {{ nodes.length }} most-linked of {{ total }} notes.
        </template>
      </p>

      <template v-if="nodes.length">
        <svg
          ref="svg"
          class="adm-graph"
          :class="{ 'adm-graph-picked': selected !== null }"
          :viewBox="`0 0 ${W} ${h}`"
          role="group"
          :aria-label="`Graph of ${nodes.length} notes`"
          @click="pick"
        >
          <g class="adm-graph-edges">
            <line
              v-for="([a, b], k) in edges"
              :key="k"
              :x1="pts[a].x"
              :y1="pts[a].y"
              :x2="pts[b].x"
              :y2="pts[b].y"
              :class="{ 'adm-graph-on': a === selected || b === selected }"
            />
          </g>
          <a
            v-for="i in byTitle"
            :key="nodes[i].id"
            :href="open(nodes[i].id)"
            :class="[
              `adm-graph-${nodes[i].kind}`,
              { 'adm-graph-on': i === selected || neighbours.has(i), 'adm-graph-selected': i === selected },
            ]"
            :aria-label="`${visible(nodes[i].title)}, ${kindName(nodes[i])}, ${plural(nodes[i].links, 'link')}`"
            @focus="selected = i"
            @mouseenter="selected = i"
          >
            <circle v-if="nodes[i].kind === 'paper'" :cx="pts[i].x" :cy="pts[i].y" :r="radius(nodes[i])" />
            <rect
              v-else-if="nodes[i].kind === 'free'"
              :x="pts[i].x - radius(nodes[i])"
              :y="pts[i].y - radius(nodes[i])"
              :width="radius(nodes[i]) * 2"
              :height="radius(nodes[i]) * 2"
            />
            <polygon v-else :points="diamond(i)" />
            <circle
              class="adm-graph-ring"
              :cx="pts[i].x"
              :cy="pts[i].y"
              :r="radius(nodes[i]) * 1.25 + (narrow ? 10 : 4)"
            />
          </a>
          <g class="adm-graph-labels" aria-hidden="true" :font-size="fontSize">
            <text
              v-for="i in labelled"
              :key="nodes[i].id"
              :x="labelAt(i).x"
              :y="labelAt(i).y"
              :text-anchor="labelAt(i).anchor"
            >
              {{ label(i) }}
            </text>
          </g>
        </svg>
        <p class="adm-muted">Circle: paper · Square: note · Diamond: chat</p>

        <div class="adm-graph-strip" aria-live="polite">
          <template v-if="selected !== null">
            <p>
              <a :href="open(nodes[selected].id)">{{ visible(nodes[selected].title) }}</a>
              <span class="adm-muted">
                · {{ KIND_NAMES[nodes[selected].kind] }} · {{ plural(nodes[selected].links, 'link') }}</span
              >
            </p>
            <ul v-if="neighbourRows.length" class="adm-graph-neighbours">
              <li v-for="n in neighbourRows" :key="n.id">
                <a :href="open(n.id)">{{ visible(n.title) }}</a>
              </li>
            </ul>
          </template>
        </div>
      </template>
    </template>
  </AdminShell>
</template>
