// 1秒に描く回数の上限（画質。低は 30fps）。画面の更新（requestAnimationFrame）のうち、間が詰まっているものは描かずに飛ばす。
// 画面の更新の時刻は少し揺れるので、数ミリ秒早く来たものは描く（そうしないと 60Hz の画面で 30fps が 20fps に落ちる）

/** 揺れを許す幅（ミリ秒） */
const SLACK_MS = 4;

/** 前に描いた時刻 last から now までで、次を描いてよいか（fps は上限） */
export function shouldDraw(now: number, last: number, fps: number): boolean {
  return now - last >= 1000 / fps - SLACK_MS;
}
