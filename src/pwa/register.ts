// Service Worker の登録（本番のビルドだけ）。全アセットを事前にキャッシュし、オフラインでも開けるようにする。
// 新しい版は裏で取り込んでおき、次に起動したときから使われる（開いている間には切り替えない）。
// Service Worker 本体は src/pwa/sw.js、ビルド時に scripts/pwa-plugin.mjs が一覧を差し込んで dist/sw.js にする。

export function registerServiceWorker(base: string): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    // 埋め込み先によっては、触れただけで例外になる
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
  } catch {
    // 登録できなくても、オンラインならそのまま動く
  }
}
