// 画面に出す版（日誌の設定のいちばん下）：ビルドした日時（日本時間）と、コミットの短い番号。
// 新しい版が届いているかを見分けるため。vite.config.ts が __APP_VERSION__ として差し込む
import { execSync } from 'node:child_process';

/** @returns {string} 例：2026.09.28 21:05 · dee2795 */
export function appVersion() {
  const f = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  let sha = '';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // git がない所でビルドしたときは日時だけ
  }
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}${sha ? ` · ${sha}` : ''}`;
}
