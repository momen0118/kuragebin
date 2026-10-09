// おじさんへ送るかを確かめる小さな札（箱の上で待っているカップの上に出す）。「この子を送る？」に、送る・やめる。
// 札の外をタップしても、やめる。出ている間は瓶への指の操作を受けない
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
