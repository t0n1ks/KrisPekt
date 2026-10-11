import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/** The site lives at https://<user>.github.io/KrisPekt/. */
const BASE = '/KrisPekt/';

/**
 * Content Security Policy for the built app. GitHub Pages cannot send headers, so it goes into
 * a <meta> tag. It is added only to the production build: the dev server injects styles from
 * JavaScript, which this policy (correctly) forbids.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "manifest-src 'self'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'krispekt-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/**
 * Serves pdf.js' pure-JS image decoders (JPEG 2000, JBIG2) and the standard PDF fonts from our
 * own origin under `pdfjs/`, so PDF import works offline and needs no WebAssembly in the CSP.
 */
function pdfjsAssets(): Plugin {
  const root = 'node_modules/pdfjs-dist';
  const files = [
    ...['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js'].map((f) => `wasm/${f}`),
    ...readdirSync(join(root, 'standard_fonts')).map((f) => `standard_fonts/${f}`),
  ];
  return {
    name: 'krispekt-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]?.replace(`${BASE}pdfjs/`, '');
        if (!path || !files.includes(path)) return next();
        res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(join(root, path)));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${file}`, source: readFileSync(join(root, file)) });
      }
    },
  };
}

export default defineConfig({
  base: BASE,
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  plugins: [
    cspMeta(),
    pdfjsAssets(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      // Registered from main.ts through the virtual module: no inline script in index.html.
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'KrisPekt',
        short_name: 'KrisPekt',
        description: 'Рукописные конспекты по предметам',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#E3E7ED',
        theme_color: '#2343B0',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: [
          '**/*.{js,mjs,css,html,png,webmanifest}',
          // Only the font subsets the four interface languages (and symbols such as ⋯ and ↔) need.
          '**/*-{latin,cyrillic,cyrillic-ext,math,symbols}-{400,500,600}-normal-*.woff2',
          'pdfjs/**/*.{js,pfb,ttf}',
        ],
        // jsPDF's optional HTML/SVG renderers are never used by the app.
        globIgnores: ['**/html2canvas*', '**/purify*', '**/index.es-*'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Any other same-origin font subset, cached on first use. Never other origins.
            urlPattern: ({ url, request }) =>
              url.origin === self.location.origin && request.destination === 'font',
            handler: 'CacheFirst',
            options: { cacheName: 'krispekt-fonts', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
