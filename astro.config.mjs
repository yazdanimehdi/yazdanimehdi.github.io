import fs from 'node:fs';
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import ffmpegPath from 'ffmpeg-static';
import tailwindcss from '@tailwindcss/vite';
import { markdownOptions } from './src/lib/markdown';
import admin from './src/integrations/admin';
import { isPageOn } from './src/lib/config';
import { modeFromEnv } from './src/lib/mode';

const mode = modeFromEnv(process.env);

// Postgres mode also decides at request time whether the built-in news art is line art to invert in dark mode
// (src/lib/inkArt.ts), which reads the image files.
const newsArt =
  mode === 'postgres'
    ? fs
        .readdirSync('src/assets/images/news-art', { recursive: true })
        .filter((f) => f.endsWith('.webp'))
        .map((f) => `./src/assets/images/news-art/${f}`)
    : [];

export default defineConfig({
  site: 'https://example.com',
  // Vercel only. Git mode: admin routes are functions, public pages prerendered. Postgres mode: every page is a
  // function, and Blob images are optimized by /_vercel/image.
  // maxDuration 300 s: Generate GIF waits one to three minutes for Higgsfield's video. The ffmpeg binary turns that
  // video into an animated WebP; the file trace doesn't see a binary, so it is listed.
  adapter:
    mode === 'static'
      ? undefined
      : mode === 'postgres'
        ? vercel({ imageService: true, includeFiles: [...newsArt, ffmpegPath], maxDuration: 300 })
        : vercel({ includeFiles: [ffmpegPath], maxDuration: 300 }),
  // Astro ignores Host / X-Forwarded-* unless they match allowedDomains, and then Astro.url is http://localhost: every
  // admin write fails the same-origin check. Vercel sets these headers at its edge and routes only the project's own
  // domains, so any https host is trusted there, whichever domain the site is served from.
  ...(mode === 'static' ? {} : { security: { allowedDomains: [{ protocol: 'https' }] } }),
  ...(mode === 'postgres'
    ? { image: { remotePatterns: [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }] } }
    : {}),
  // @astrojs/sitemap only sees prerendered pages; Postgres mode serves its own /sitemap-index.xml. It lists routes, not
  // written files, so pages turned off in site.yml are filtered out.
  integrations: [
    vue({ appEntrypoint: '/src/pages/_app.ts' }),
    mdx(),
    ...(mode === 'postgres' ? [] : [sitemap({ filter: (page) => isPageOn(new URL(page).pathname) })]),
    admin(),
  ],
  markdown: markdownOptions,
  vite: {
    plugins: [tailwindcss()],
    build: {
      modulePreload: {
        polyfill: true,
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Merge the tiny Vue export helper (~0.77 KiB) into the Vue
            // runtime chunk to eliminate one hop in critical request chains
            if (id.includes('plugin-vue') && id.includes('export-helper')) {
              return 'runtime-dom.esm-bundler';
            }
            if (id.includes('vue') && id.includes('runtime-dom')) {
              return 'runtime-dom.esm-bundler';
            }
          },
        },
      },
    },
  },
});
