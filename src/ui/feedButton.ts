// 餌のスポイト。右下のいちばん隅に、いつも小さなアイコンを出す（ライトはその内側）。
// 押すと瓶に餌をやる。1瓶につき1日1回までで、やれないときは何も起きない（アイコンの見た目も変えない）。
// スポイトを使っている間だけ、アイコンを少し明るくする。
import { jarActions, keepToSelf } from './jarActions';

const ICON = `
<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <g transform="rotate(38 12 12)">
    <path d="M9.7 9.6V6.1a2.3 2.3 0 0 1 4.6 0v3.5z" />
    <path d="M9 9.6h6" />
    <path d="M11.1 9.6v8.3l0.9 2.9 0.9-2.9V9.6" />
  </g>
</svg>`;

export class FeedButton {
  private readonly el: HTMLButtonElement;
  private busy = false;

  constructor(onFeed: () => void) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'feed-button';
    el.setAttribute('aria-label', '餌');
    el.innerHTML = ICON;
    el.addEventListener('click', () => onFeed());
    keepToSelf(el);
    jarActions().appendChild(el);
    this.el = el;
  }

  /** スポイトを使っている間は少し明るく */
  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    this.el.classList.toggle('busy', busy);
  }
}
