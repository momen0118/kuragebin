// 画面のタップを拾う。指が大きく動いたもの（スワイプ）や長押しはタップとみなさない。

const MAX_MOVE_PX = 12;
const MAX_TIME_MS = 450;

/** タップされた位置を -1〜1（左下が -1）で渡す */
export function onTap(el: HTMLElement, handler: (ndcX: number, ndcY: number) => void): void {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let id: number | null = null;
  el.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MAX_MOVE_PX) return;
    if (performance.now() - startT > MAX_TIME_MS) return;
    const r = el.getBoundingClientRect();
    handler(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  });
  el.addEventListener('pointercancel', () => {
    id = null;
  });
}
