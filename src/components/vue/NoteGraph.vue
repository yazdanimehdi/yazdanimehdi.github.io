<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { visible } from '../../lib/career/text';
import { plural } from '../../admin/status';
import { KIND_NAMES, layout, nearestNode } from '../../admin/vault';

// The notes graph, for the admin vault and the public Notes page. Colors come from --graph-* custom properties.
// Titles may come from a paper's title: shown with {{ }} and attributes only, never as HTML.
type Node = { title: string; kind: 'paper' | 'free' | 'chat'; links: number; href: string };
/** `nodes` most-linked first (the first ones get labels); `edges` are index pairs into it. */
const props = defineProps<{ nodes: Node[]; edges: [number, number][] }>();
const selected = defineModel<number | null>('selected', { default: null });

const W = 1000;
const LABELS = 15;
const PICK = 24; // CSS px

const pts = ref<{ x: number; y: number }[]>([]);
const narrow = ref(false);
const h = computed(() => (narrow.value ? 1000 : 625));

const kindName = (n: Node) => KIND_NAMES[n.kind].toLowerCase();
/** Node indexes, by title, so Tab walks titles alphabetically. */
const byTitle = computed(() =>
  props.nodes.map((_, i) => i).sort((a, b) => props.nodes[a].title.localeCompare(props.nodes[b].title)),
);
// A phone draws 1000 units in ~360 px: nodes 2.5× bigger stay ~9–20 px across.
const radius = (n: Node) => (5 + Math.min(n.links, 10) * 0.6) * (narrow.value ? 2.5 : 1);
const neighbours = computed(() => {
  const s = selected.value;
  const out = new Set<number>();
  if (s === null) return out;
  for (const [a, b] of props.edges) {
    if (a === s) out.add(b);
    else if (b === s) out.add(a);
  }
  return out;
});
/**
 * The most-linked (5 on a phone) until a node is selected, then it and its neighbours only. A label that would
 * overlap one already placed is left out (each node's aria-label still names it).
 */
const labelled = computed(() => {
  const s = selected.value;
  const top = s !== null ? 0 : narrow.value ? 5 : LABELS;
  const want = s === null ? [] : [s, ...[...neighbours.value].sort((a, b) => a - b)];
  want.push(...props.nodes.slice(0, top).map((_, i) => i));
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
  const t = visible(props.nodes[i].title);
  const max = narrow.value ? 22 : 32;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
function labelAt(i: number) {
  const p = pts.value[i];
  const r = radius(props.nodes[i]) + 4;
  const left = p.x > W / 2;
  return { x: left ? p.x - r : p.x + r, y: p.y + fontSize.value / 3, anchor: left ? 'end' : 'start' };
}
function diamond(i: number) {
  const { x, y } = pts.value[i];
  const r = radius(props.nodes[i]) * 1.25;
  return `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
}

const svg = ref<SVGSVGElement | null>(null);
/** A tap or click off a node: the nearest node within 24 CSS px, or nothing. */
function pick(e: MouseEvent) {
  if ((e.target as Element).closest('a')) return;
  const m = svg.value?.getScreenCTM();
  if (!m) return;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  selected.value = nearestNode(pts.value, p.x, p.y, PICK / m.a);
}

// After mount: the phone check needs the browser, so the server renders an empty box.
onMounted(() => {
  narrow.value = matchMedia('(max-width: 639.98px)').matches;
  // room for the phone's bigger nodes inside the layout's margin
  const pad = narrow.value ? 16 : 0;
  pts.value = layout(props.nodes.length, props.edges, W - 2 * pad, h.value - 2 * pad).map((p) => ({
    x: p.x + pad,
    y: p.y + pad,
  }));
});
</script>

<template>
  <div class="note-graph">
    <svg
      v-if="pts.length"
      ref="svg"
      :class="{ picked: selected !== null }"
      :viewBox="`0 0 ${W} ${h}`"
      role="group"
      :aria-label="`Graph of ${nodes.length} notes`"
      @click="pick"
    >
      <g class="edges">
        <line
          v-for="([a, b], k) in edges"
          :key="k"
          :x1="pts[a].x"
          :y1="pts[a].y"
          :x2="pts[b].x"
          :y2="pts[b].y"
          :class="{ on: a === selected || b === selected }"
        />
      </g>
      <a
        v-for="i in byTitle"
        :key="nodes[i].href"
        :href="nodes[i].href"
        :class="[nodes[i].kind, { on: i === selected || neighbours.has(i), selected: i === selected }]"
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
        <circle class="halo" :cx="pts[i].x" :cy="pts[i].y" :r="radius(nodes[i]) * 1.25 + (narrow ? 10 : 4)" />
      </a>
      <g class="labels" aria-hidden="true" :font-size="fontSize">
        <text
          v-for="i in labelled"
          :key="nodes[i].href"
          :x="labelAt(i).x"
          :y="labelAt(i).y"
          :text-anchor="labelAt(i).anchor"
        >
          {{ label(i) }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
/* Kind by shape and color; a selection lights its edges and neighbours and dims the rest. */
.note-graph:empty {
  aspect-ratio: 1000 / 625;
}
@media (max-width: 639.98px) {
  .note-graph:empty {
    aspect-ratio: 1;
  }
}
svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--graph-rule);
  border-radius: 6px;
  touch-action: manipulation;
}
.edges line {
  stroke: var(--graph-rule);
  stroke-width: 1px;
  vector-effect: non-scaling-stroke;
}
.edges line.on {
  stroke: var(--graph-accent);
  stroke-width: 2px;
}
.paper {
  fill: var(--graph-accent);
}
.free {
  fill: var(--graph-ink);
}
.chat {
  fill: var(--graph-muted);
}
/* The focus ring is a stroke, not an outline, which WebKit does not paint on SVG shapes. */
.note-graph a:focus {
  outline: none;
}
.halo {
  fill: none;
  stroke: none;
  stroke-width: 2px;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
a:focus-visible > .halo,
.selected > .halo {
  stroke: var(--graph-accent);
}
.picked a:not(.on, :focus-visible) {
  opacity: 0.35;
}
.labels {
  fill: var(--graph-ink);
  font-family: var(--font-sans);
  paint-order: stroke;
  stroke: var(--graph-paper);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}
</style>
