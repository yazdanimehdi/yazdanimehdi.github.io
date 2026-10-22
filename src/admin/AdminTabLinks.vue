<script setup lang="ts">
/** A row of links under a page title that move between sibling screens; the current one is `aria-current`. */
defineProps<{ label: string; tabs: { href: string; label: string; current?: boolean; count?: number }[] }>();
</script>

<template>
  <nav class="adm-tablinks" :aria-label="label">
    <a v-for="t in tabs" :key="t.href" :href="t.href" :aria-current="t.current ? 'page' : undefined"
      >{{ t.label }}<span v-if="t.count" class="adm-count">{{ t.count }}</span></a
    >
  </nav>
</template>
