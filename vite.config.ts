/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名のパスで配信される
export default defineConfig({
  base: '/kuragebin/',
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
