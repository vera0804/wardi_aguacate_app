import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { matchOfflineApiPathname } from './src/offline/offlineConfig.js';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'],
      manifest: {
        id: '/',
        name: 'Wardi — Gestión de fincas aguacateras',
        short_name: 'Wardi',
        description: 'Gestión operativa de fincas, lotes, labores y producción de aguacate.',
        lang: 'es',
        dir: 'ltr',
        theme_color: '#4d7c0f',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        categories: ['business', 'productivity'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && matchOfflineApiPathname(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'wardi-api-read-v2',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 14,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
              fetchOptions: {
                credentials: 'include',
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
