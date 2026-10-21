<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- config files are user data */
import { onMounted } from 'vue';
import AdminShell from './AdminShell.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import { api } from './api';
import { SOCIALS, select, text, type FieldDef } from './fields';
import { HERO_PATTERN_NAMES, HERO_PATTERN_STRENGTH } from '../lib/hero-patterns';
import { useDocument } from './useDocument';
import type { AdminCtx, CommitResult } from './types';

type Config = Record<string, any>;
defineProps<{ ctx: AdminCtx }>();

const GROUPS: { label: string; fields: FieldDef[] }[] = [
  {
    label: 'Identity',
    fields: [
      select('siteMode', 'Site mode', ['personal', 'lab']),
      text('title', 'Site title'),
      { key: 'description', label: 'Description', type: 'textarea' },
      text('author', 'Author (personal mode)'),
      text('labName', 'Lab name (lab mode)'),
      text('university', 'University'),
      text('department', 'Department'),
      text('siteUrl', 'Site URL'),
      {
        key: 'logo',
        label: 'Logo',
        type: 'image',
        folder: 'site',
        hint: 'Shown beside the name in the header, 28px tall. Any shape: a wide wordmark keeps its proportions.',
      },
      {
        key: 'favicon',
        label: 'Favicon',
        type: 'image',
        folder: 'site',
        hint: 'The browser-tab and phone home-screen icon: a square PNG (at least 180px, solid background), SVG or ICO. Empty: the built-in icons.',
      },
      text('lang', 'Language (BCP 47, e.g. en)'),
    ],
  },
  {
    label: 'Theme & colors',
    fields: [
      select('theme', 'Theme', ['classic', 'editorial']),
      select('defaultTheme', 'Light or dark by default (classic)', ['light', 'dark', 'system']),
      {
        key: 'brand.primary',
        label: 'Brand primary',
        type: 'color',
        hint: 'Set your brand colors and the site does the rest: the accent for links, buttons and tiles in light and dark mode (adjusted only as far as needed to stay readable), its hover and selection shades, and the hero pattern’s gradient. Brand colors replace the two accent colors below; leave them empty to use those instead.',
      },
      {
        key: 'brand.secondary',
        label: 'Brand secondary',
        type: 'color',
        hint: 'The gradient’s second color, and the classic theme’s highlight color. Empty: the primary alone.',
      },
      { key: 'colors.light.primary', label: 'Accent color (without brand colors)', type: 'color' },
      { key: 'colors.dark.primary', label: 'Accent color in dark mode (without brand colors)', type: 'color' },
      {
        key: 'editorial.night',
        label: 'Night palette (journal, dark mode)',
        type: 'select',
        options: [
          { value: 'lamplight', label: 'Lamplight: warm charcoal, ivory ink, night blue (default)' },
          { value: 'inkwell', label: 'Ink Well: deep blue-black paper, cool ink, periwinkle' },
          { value: 'galley', label: 'Galley Proof: neutral graphite, grey ink, slate-teal' },
        ],
        hint: 'A dark-mode accent color above is lifted until it reads at 4.5:1 on the chosen palette.',
      },
      {
        key: 'newsArt',
        label: 'News art style',
        type: 'select',
        options: [
          { value: 'ink', label: 'Ink line plate' },
          { value: 'engraving', label: 'Engraving' },
          { value: 'watercolor', label: 'Soft watercolor' },
          { value: 'geometric', label: 'Flat geometric' },
        ],
        hint: 'The picture a news item shows when it has no image of its own, one per category. Empty follows the theme: journal uses ink plates, classic flat geometric.',
      },
    ],
  },
  {
    label: 'Fonts',
    fields: [
      text('fonts.families.sans', 'Sans-serif font'),
      text('fonts.families.serif', 'Serif font'),
      text('fonts.families.mono', 'Monospace font'),
    ],
  },
  {
    label: 'Navigation',
    fields: [
      { key: 'nav', label: 'Menu items', type: 'objects', fields: [text('label', 'Label'), text('href', 'Link')] },
    ],
  },
  {
    label: 'Socials',
    fields: [
      text('socials.email', 'Email'),
      ...SOCIALS.map((s) => text(`socials.${s}`, `${s[0].toUpperCase()}${s.slice(1)} URL`)),
    ],
  },
  {
    label: 'Top bar',
    fields: [
      { key: 'topBar.enabled', label: 'Show the top bar', type: 'checkbox' },
      text('topBar.text', 'Top bar text'),
    ],
  },
  {
    label: 'Hero',
    fields: [
      select('hero.type', 'Background', ['image', 'video', 'pattern', 'animation', 'none']),
      select('hero.pattern.name', 'Pattern', HERO_PATTERN_NAMES),
      {
        key: 'hero.pattern.color',
        label: 'Pattern color',
        type: 'color',
        hint: 'Empty: the brand gradient when brand colors are set, otherwise the text color; both follow light and dark mode. Type accent or secondary for one brand color, or pick any color.',
      },
      {
        key: 'hero.pattern.color2',
        label: 'Pattern gradient to',
        type: 'color',
        hint: 'Set a second color to run the lines in a gradient. Empty: one color.',
      },
      { key: 'hero.pattern.angle', label: 'Gradient angle (degrees, default 135)', type: 'number' },
      {
        ...select('hero.pattern.strength', 'Pattern strength', Object.keys(HERO_PATTERN_STRENGTH)),
        hint: 'A fixed color stays the same in dark mode: a saturated one usually wants strong there.',
      },
      {
        key: 'hero.pattern.fade',
        label: 'Fade the pattern toward the text',
        type: 'checkbox',
        default: true,
      },
      {
        key: 'hero.pattern.interactive',
        label: 'Light up the pattern around the cursor',
        type: 'checkbox',
        hint: 'On computers with a mouse or trackpad; phones and tablets keep the still pattern.',
      },
      { key: 'hero.light.bgColor', label: 'Background color', type: 'color' },
      { key: 'hero.light.bgImage', label: 'Background image', type: 'image', folder: 'site' },
      { key: 'hero.dark.bgColor', label: 'Background color (dark mode)', type: 'color' },
      { key: 'hero.dark.bgImage', label: 'Background image (dark mode)', type: 'image', folder: 'site' },
    ],
  },
  {
    label: 'Admin users',
    fields: [
      {
        key: 'adminUsers',
        label: 'GitHub usernames',
        type: 'list',
        hint: 'Who can sign in here. Changes take effect after the redeploy this save triggers.',
      },
    ],
  },
];

const FEEDS: FieldDef[] = [
  {
    key: 'mediumUrl',
    label: 'Medium feed URL',
    type: 'text',
    hint: 'Your Medium RSS feed, e.g. https://medium.com/feed/@username. Its posts appear on the Blog posts screen under Imported from feeds.',
  },
  {
    key: 'feeds',
    label: 'Feed sources',
    type: 'objects',
    fields: [
      text('name', 'Name'),
      text('url', 'Feed URL'),
      text('author', 'Author (people id)'),
      { key: 'tags', label: 'Tags', type: 'list' },
    ],
  },
  { key: 'maxItemsPerFeed', label: 'Items per feed', type: 'number' },
];

const site = useDocument<Config>();
const feeds = useDocument<Config>();
const loader = (file: string) => async () => {
  const { data, version } = await api<{ data: Config; version: string | null }>(`config/${file}`);
  return { value: data, version };
};
const publish = (doc: typeof site, file: string) =>
  doc.save(
    (data, version) => api<CommitResult>(`config/${file}`, { method: 'PUT', body: { data, version } }),
    `config/${file}.yml`,
  );

onMounted(() => {
  site.open('config/site#settings', loader('site'));
  feeds.open('config/feeds', loader('feeds'));
});
</script>

<template>
  <AdminShell :ctx="ctx" active="settings" title="Settings">
    <template #actions>
      <button
        type="button"
        class="adm-btn adm-btn-primary"
        :disabled="site.saving || !site.current"
        @click="publish(site, 'site')"
      >
        Publish settings
      </button>
    </template>
    <DocBanners
      :draft="!!site.draft"
      :path="'config/site.yml'"
      :version="site.version"
      :conflict="site.conflict"
      :stale="site.draftStale ? site.draftChanges : null"
      @restore="site.restore()"
      @discard="site.discard()"
      @reload="site.reload()"
    />
    <template v-if="site.current">
      <fieldset v-for="group in GROUPS" :key="group.label" class="adm-group">
        <legend>{{ group.label }}</legend>
        <FormFields :fields="group.fields" :model="site.current" :errors="site.errors" />
      </fieldset>
    </template>

    <fieldset id="feeds" class="adm-group">
      <legend>Feeds</legend>
      <DocBanners
        :draft="!!feeds.draft"
        :path="'config/feeds.yml'"
        :version="feeds.version"
        :conflict="feeds.conflict"
        :stale="feeds.draftStale ? feeds.draftChanges : null"
        @restore="feeds.restore()"
        @discard="feeds.discard()"
        @reload="feeds.reload()"
      />
      <p class="adm-muted">
        Saved to config/feeds.yml. Sync them from Site status on the <a :href="`/${ctx.adminPath}`">Dashboard</a>.
      </p>
      <FormFields v-if="feeds.current" :fields="FEEDS" :model="feeds.current" :errors="feeds.errors" />
      <div class="adm-actions">
        <button
          type="button"
          class="adm-btn"
          :disabled="feeds.saving || !feeds.current"
          @click="publish(feeds, 'feeds')"
        >
          Publish feeds
        </button>
      </div>
    </fieldset>
  </AdminShell>
</template>
