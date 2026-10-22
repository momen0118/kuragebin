// 画面に HTML として差し込む文字の下ごしらえ。
/** HTML の特別な文字（& < > " '）を文字として出るように置き換える（名前や文面をページに差し込むとき） */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
