/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { serviceWorker } from './scripts/pwa-plugin.mjs';
import { appVersion } from './scripts/version.mjs';

// GitHub Pages ではリポジトリ名のパスで配信される
export default defineConfig({
  base: '/kuragebin/',
  plugins: [serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // three.js を含むので1ファイルが大きい
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
