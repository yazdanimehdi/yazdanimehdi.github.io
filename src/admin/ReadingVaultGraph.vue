<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import NoteGraph from '../components/vue/NoteGraph.vue';
import { api, report } from './api';
import { visible } from './career';
import { plural } from './status';
import { KIND_NAMES } from './vault';
import type { AdminCtx } from './types';
import type { NoteRow } from '../lib/reading/types';

// Titles may come from a paper's title: shown with {{ }} and attributes only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const open = (id: number) => `${base}/reading/vault/${id}`;

type GraphNode = NoteRow & { links: number };

const nodes = ref<GraphNode[] | null>(null);
const edges = ref<[number, number][]>([]); // node indexes
const total = ref(0);
const selected = ref<number | null>(null);
const graphNodes = computed(() => (nodes.value ?? []).map((n) => ({ ...n, href: open(n.id) })));

const neighbourRows = computed(() => {
  const s = selected.value;
  if (s === null || !nodes.value) return [];
  return edges.value
    .flatMap(([a, b]) => (a === s ? [b] : b === s ? [a] : []))
    .map((i) => nodes.value![i])
    .sort((a, b) => a.title.localeCompare(b.title));
});

onMounted(async () => {
  try {
    const g = await api<{ nodes: GraphNode[]; edges: [number, number][]; total: number }>('reading/vault/graph');
    const index = new Map(g.nodes.map((n, i) => [n.id, i]));
    const kept = g.edges.flatMap(([a, b]): [number, number][] => {
      const [i, j] = [index.get(a), index.get(b)];
      return i === undefined || j === undefined ? [] : [[i, j]];
    });
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
        <NoteGraph v-model:selected="selected" :nodes="graphNodes" :edges="edges" />
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
