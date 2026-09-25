// Service Worker 本体。ビルド時に scripts/pwa-plugin.mjs が __VERSION__ と __FILES__ を差し込んで dist/sw.js にする。
// 全アセットを事前にキャッシュし、キャッシュから返す（オフラインで完全に動く）。
// 新しい版は裏で取り込み、開いている画面がすべて閉じた次の起動から使われる（skipWaiting しない）。

const VERSION = __VERSION__;
const FILES = __FILES__;
const PREFIX = 'kuragebin-';
const CACHE = PREFIX + VERSION;
const INDEX = new URL('index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // HTTP のキャッシュに古いものが残っていても使わない
      .then((cache) => cache.addAll(FILES.map((f) => new Request(new URL(f, self.location.href), { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // 画面を開くとき（?debug などの付いた URL でも）は index.html を返す
      const hit =
        req.mode === 'navigate'
          ? ((await cache.match(req, { ignoreSearch: true })) ?? (await cache.match(INDEX)))
          : await cache.match(req);
      return hit ?? fetch(req);
    })(),
  );
});
