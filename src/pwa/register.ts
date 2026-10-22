// Service Worker の登録（本番のビルドだけ）。全アセットを事前にキャッシュし、オフラインでも開けるようにする。
// 新しい版は裏で取り込んでおき、開いたときか画面に戻ったときに、取り込み済みなら保存してから一度だけ読み直して切り替える
// （見ている間には切り替えない）。iOS のホーム画面のアプリは裏で止まっているだけのことが多く、次の起動を待つと古い版のまま残るため。
// Service Worker 本体は src/pwa/sw.js、ビルド時に scripts/pwa-plugin.mjs が一覧を差し込んで dist/sw.js にする。

/** beforeReload は、新しい版へ切り替えて読み直す前に呼ぶ（状態の保存） */
export function registerServiceWorker(base: string, beforeReload: () => Promise<void>): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    // 埋め込み先によっては、触れただけで例外になる
    const sw = navigator.serviceWorker;
    // 初めて入ったとき（前の版がない）は、使われはじめても読み直さない
    const hadController = sw.controller !== null;
    let switching = false;
    let reloading = false;

    sw.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      // ほかの画面が切り替えたときは保存しない（そちらの新しい状態を古い状態で上書きしないように）。保存は隠れたときに済んでいる
      location.reload();
    });

    const switchIfWaiting = async (reg: ServiceWorkerRegistration): Promise<boolean> => {
      const waiting = reg.waiting;
      if (!waiting || !hadController || switching) return false;
      switching = true;
      try {
        await beforeReload();
      } catch {
        // 保存できなくても切り替える（閉じていた分は開き直したときに進め直す）
      }
      // 待っている新しい版を使いはじめさせる。使われはじめると controllerchange で読み直す
      waiting.postMessage('skip-waiting');
      return true;
    };

    sw.register(`${base}sw.js`, { scope: base })
      .then((reg) => {
        void switchIfWaiting(reg);
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) return;
          void switchIfWaiting(reg).then((switched) => {
            // 新しい版があるかを確かめに行く。見つかれば裏で取り込み、次に戻ったときに切り替える
            if (!switched) reg.update().catch(() => {});
          });
        });
      })
      .catch(() => {});
  } catch {
    // 登録できなくても、オンラインならそのまま動く
  }
}
