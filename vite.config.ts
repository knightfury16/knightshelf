import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const YEAR = 60 * 60 * 24 * 365;

export default defineConfig(({ mode }) => ({
  /**
   * GitHub Pages serves this project from a subpath; dev serves from root.
   *
   * Keyed on `mode`, not `command`: `vite preview` runs with command 'serve' but
   * mode 'production', so keying on command would serve the built app at `/`
   * while its HTML asks for `/knightshelf/...` — every asset 404s and you can't
   * verify a production build locally.
   */
  base: mode === 'production' ? '/knightshelf/' : '/',

  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      // scope and start_url are derived from `base` by the plugin — leaving them
      // unset keeps dev (/) and production (/knightshelf/) both correct.
      manifest: {
        name: 'Knightshelf',
        short_name: 'Knightshelf',
        description: 'A commonplace book for words met while reading.',
        lang: 'en',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f2eee4',
        theme_color: '#f2eee4',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Chrome on Android crops to an adaptive shape; the maskable variant
          // keeps its artwork inside the safe zone so nothing gets clipped.
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        /**
         * Fonts are deliberately NOT precached.
         *
         * @fontsource ships every unicode subset (latin, latin-ext, vietnamese),
         * and precaching downloads all of them upfront — about 1 MB on a first
         * visit over mobile data. Left to itself, the browser honours the
         * `unicode-range` on each @font-face and fetches only the subset the text
         * actually needs, so English never pulls the Vietnamese cut. The runtime
         * rule below then keeps whatever was fetched available offline.
         */
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'ks-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: YEAR },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Every definition you've ever fetched stays readable offline.
            urlPattern: /^https:\/\/api\.dictionaryapi\.dev\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ks-dictionary',
              expiration: { maxEntries: 3000, maxAgeSeconds: YEAR },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/covers\.openlibrary\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ks-covers',
              expiration: { maxEntries: 600, maxAgeSeconds: YEAR },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Search results go stale fast and are useless offline; keep them brief.
            urlPattern: /^https:\/\/openlibrary\.org\/search\.json.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ks-booksearch',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}));
