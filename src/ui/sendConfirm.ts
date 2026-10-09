// おじさんへ送るかを確かめる小さな札（箱の上で待っているカップの上に出す）。「この子を送る？」に、送る・やめる。
// 札の外をタップしても、やめる。出ている間は瓶への指の操作を受けない。
// ほかに、運んでいる間に天板の手前に出す「おじさんに送る」と下向きの印（SendHint）
import { keepToSelf } from './jarActions';

export class SendConfirm {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private answer: ((send: boolean) => void) | null = null;

  constructor() {
    const root = document.createElement('div');
    root.className = 'send-confirm';
    root.innerHTML = `<div class="send-card" role="dialog" aria-label="送るか確かめる"><p>この子を送る？</p><div class="send-buttons"><button type="button" data-send="1">送る</button><button type="button" data-send="0">やめる</button></div></div>`;
    document.body.appendChild(root);
    keepToSelf(root);
    this.root = root;
    this.card = root.querySelector('.send-card')!;
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-send]');
      if (b) this.done(b.dataset.send === '1');
      else if (!this.card.contains(e.target as Node)) this.done(false);
    });
  }

  get isOpen(): boolean {
    return this.answer !== null;
  }

  /** 札を出す。at は札の下端の真ん中（CSS px）。answer は送るなら true */
  ask(at: { x: number; y: number }, answer: (send: boolean) => void): void {
    this.answer = answer;
    this.card.style.left = `${at.x.toFixed(1)}px`;
    this.card.style.top = `${at.y.toFixed(1)}px`;
    this.root.classList.add('shown');
  }

  /** 部屋の明るさに合わせた紙の明るさ（1 で昼） */
  setLum(lum: number): void {
    this.root.style.setProperty('--lum', lum.toFixed(3));
  }

  private done(send: boolean): void {
    const answer = this.answer;
    if (!answer) return;
    this.answer = null;
    this.root.classList.remove('shown');
    answer(send);
  }
}

/**
 * カップで運んでいる間に、天板の手前（画面の下の真ん中）に出す「おじさんに送る」と下向きの印。
 * ここまでカップを運ぶと箱が出てきて送れる、と分かるように。指がそこまで来たら消える（代わりに箱がせり上がる）
 */
export class SendHint {
  private readonly el: HTMLDivElement;
  private shown = false;

  constructor() {
    const el = document.createElement('div');
    el.className = 'send-hint';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<span>おじさんに送る</span><svg viewBox="0 0 22 10" width="22" height="10"><path d="M1 1.5L11 8.5L21 1.5"/></svg>`;
    document.body.appendChild(el);
    this.el = el;
  }

  set(show: boolean): void {
    if (show === this.shown) return;
    this.shown = show;
    this.el.classList.toggle('shown', show);
  }
}
