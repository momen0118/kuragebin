import type { Plugin } from 'vite';

/** ビルドの最後に Service Worker（dist/sw.js）を作る */
export function serviceWorker(): Plugin;
