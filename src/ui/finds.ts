// 拾いものの手触り。拾った物は小さな光になって左下の日誌のアイコンへ吸い込まれる（文字は出さない）。
// 標本から瓶へ戻すときは、標本の写真が指の少し上についてくる。瓶底の上で離すと置き、外で離すと光になって標本へ戻る。
import { FIND_FLIGHT } from '../config';

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** 光が from から to（画面の CSS px）へ、少し上へふくらむ弧を描いて飛び、着いたら onArrive */
export function flyLight(from: { x: number; y: number }, to: { x: number; y: number }, onArrive: () => void = () => {}): void {
  const el = document.createElement('div');
  el.className = 'find-spark';
  document.body.appendChild(el);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const ms = reduced ? 1 : FIND_FLIGHT.seconds * 1000;
  const [s0, s1] = FIND_FLIGHT.size;
  const t0 = performance.now();
  const step = (now: number): void => {
    const k = Math.min((now - t0) / ms, 1);
    const e = ease(k);
    // 2次のベジエ（真ん中の制御点を上へ持ち上げる）
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - FIND_FLIGHT.arc;
    const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
    const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
    const size = s0 + (s1 - s0) * e;
    el.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px)`;
    el.style.width = el.style.height = `${size.toFixed(1)}px`;
    // はじめにふっと明るくなり、着くころに消える
    el.style.opacity = (Math.min(k / 0.12, 1) * (1 - ease((k - 0.8) / 0.2))).toFixed(3);
    if (k < 1) requestAnimationFrame(step);
    else {
      el.remove();
      onArrive();
    }
  };
  requestAnimationFrame(step);
}

export interface FindCarryOptions {
  /** 運んでいる物を離した所（画面の CSS px）。瓶底に置けたら true（置けなければ標本へ戻す） */
  drop(id: number, x: number, y: number): boolean;
  /** その所が瓶底の上か（運んでいる間の見た目） */
  over(x: number, y: number): boolean;
  /** 標本へ戻るときの行き先（日誌のアイコンの真ん中） */
  home(): { x: number; y: number };
  /** 戻り着いた */
  returned(): void;
}

/** 標本から瓶へ運ぶ。写真が指の少し上についてくる */
export class FindCarry {
  private ghost: HTMLDivElement | null = null;
  private id = 0;
  private pointer = -1;
  private x = 0;
  private y = 0;

  constructor(private readonly opts: FindCarryOptions) {
    window.addEventListener('pointermove', (e) => this.move(e), { passive: true });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
  }

  get active(): boolean {
    return this.ghost !== null;
  }

  /** 運びはじめる（標本の物 id、写真、指の位置と番号） */
  start(id: number, photo: string | null, x: number, y: number, pointer: number): void {
    this.ghost?.remove();
    const g = document.createElement('div');
    g.className = 'find-ghost';
    if (photo) g.style.backgroundImage = `url("${photo}")`;
    document.body.appendChild(g);
    this.ghost = g;
    this.id = id;
    this.pointer = pointer;
    this.place(x, y);
    requestAnimationFrame(() => g.classList.add('shown'));
  }

  /** 物の見えている所（指の少し上） */
  private place(x: number, y: number): void {
    this.x = x;
    this.y = y - FIND_FLIGHT.carryLift;
    const g = this.ghost;
    if (!g) return;
    g.style.transform = `translate(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px)`;
    g.classList.toggle('over', this.opts.over(this.x, this.y));
  }

  private move(e: PointerEvent): void {
    if (!this.ghost || e.pointerId !== this.pointer) return;
    this.place(e.clientX, e.clientY);
  }

  private up(e: PointerEvent, cancel = false): void {
    const g = this.ghost;
    if (!g || e.pointerId !== this.pointer) return;
    this.ghost = null;
    if (!cancel) this.place(e.clientX, e.clientY);
    const placed = !cancel && this.opts.drop(this.id, this.x, this.y);
    if (placed) {
      // 水へ入っていく：ふっと消える（瓶の中では水面のすぐ下から沈んでいく）
      g.classList.add('placed');
      setTimeout(() => g.remove(), 400);
      return;
    }
    g.remove();
    flyLight({ x: this.x, y: this.y }, this.opts.home(), () => this.opts.returned());
  }
}
