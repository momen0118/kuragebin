// 観察日誌のアイコン。左下の隅にいつも出す（右下は瓶に何かをする操作）。
// 日誌に一行増えたら小さな点が付き、日誌を開いたら消える。開いたときに押し付けない。
import { keepToSelf } from '../jarActions';

const ICON = `
<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6.5 5.5h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" />
  <path d="M8.5 3.6v3.4M12 3.6v3.4M15.5 3.6v3.4" />
  <path d="M8.5 11h7M8.5 14.5h5" />
</svg>`;

export class JournalButton {
  private readonly el: HTMLButtonElement;
  private unread = false;
  private glowTimer = 0;

  constructor(onOpen: () => void) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'journal-button';
    el.setAttribute('aria-label', '観察日誌');
    el.innerHTML = `${ICON}<span class="unread" aria-hidden="true"></span>`;
    el.addEventListener('click', () => onOpen());
    keepToSelf(el);
    document.body.appendChild(el);
    this.el = el;
  }

  /** アイコンの真ん中（画面の CSS px）。拾った物の光が吸い込まれる先 */
  center(): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** 光を受け取った：アイコンが少しのあいだ明るくなる */
  glow(): void {
    this.el.classList.remove('absorb');
    void this.el.offsetWidth;
    this.el.classList.add('absorb');
    clearTimeout(this.glowTimer);
    this.glowTimer = window.setTimeout(() => this.el.classList.remove('absorb'), 900);
  }

  /** 未読の点 */
  setUnread(unread: boolean): void {
    if (unread === this.unread) return;
    this.unread = unread;
    this.el.classList.toggle('has-unread', unread);
    this.el.setAttribute('aria-label', unread ? '観察日誌（新しい記録あり）' : '観察日誌');
  }
}
