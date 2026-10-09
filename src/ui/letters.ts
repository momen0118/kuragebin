// おじさんの手紙の文面と、手紙を読む紙（日誌のページに留めた手紙や、机の上の封筒をタップしたとき）。
// 研究者らしく素っ気ない文体。感嘆符・顔文字は使わない。返事は一、二行で、送った子に触れる程度。
// 文面は種類（送った子の特徴）ごとに数パターンあり、届いたときに決めた番号で選ぶ。
import { UNCLE } from '../config';
import type { Letter, LetterTopic } from '../sim/state';
import { keepToSelf } from './jarActions';

/** 最初の手紙（仮の文面） */
const FIRST: readonly string[] = [
  '研究室で殖えすぎたので、一匹送ります。',
  'ミズクラゲです。',
  '蓋はいりません。餌はやりすぎないこと。',
  '増えても海には放さないでください。こちらで引き取ります。',
  'いろいろな顔のを見てみたいので、気が向いたら送ってください。',
];

/** 返事の文面（送った子の特徴ごと） */
const REPLIES: Record<LetterTopic, ReadonlyArray<readonly string[]>> = {
  five: [['送ってくれた五つ葉、元気です。'], ['五つ葉、届きました。', 'こちらでもあまり見ない顔です。'], ['五つ葉のは、水槽の中でもよく目立ちます。']],
  three: [['三つ葉のが届きました。口腕も三本でした。'], ['送ってくれた三つ葉、落ち着いて泳いでいます。'], ['三つ葉は久しぶりに見ました。']],
  pink: [['薄桃のは、こちらでも珍しい。'], ['送ってくれた薄桃の、照明の下だとよくわかります。'], ['薄桃色のが届きました。元気です。']],
  blue: [['青みのある子が届きました。', 'こちらの水槽にはいない色です。'], ['送ってくれた青っぽいの、元気です。'], ['薄い青のは、窓の光でよく透けます。']],
  flawed: [['縁の欠けた子、泳ぎは達者です。'], ['少し形の崩れた子が届きました。よく食べます。'], ['いびつなのも、見ていて飽きません。']],
  ephyra: [['小さいのが届きました。', 'もう腕の間が埋まりはじめています。'], ['エフィラ、無事に着きました。よく脈打っています。'], ['小さいの、こちらで育てます。']],
  plain: [['届きました。水槽の隅が気に入ったようです。'], ['送ってくれた子、元気です。'], ['届きました。よく食べます。']],
};

/** 手紙の本文（署名は別） */
export function letterLines(l: Pick<Letter, 'kind' | 'topic' | 'pick'>): readonly string[] {
  if (l.kind === 'first') return FIRST;
  const list = REPLIES[l.topic ?? 'plain'] ?? REPLIES.plain;
  return list[l.pick % list.length]!;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * 手紙を読む紙。画面の真ん中に少し大きく開き、どこかをタップすると閉じる（閉じると元の画面やページに戻る）。
 * 夜は部屋の明るさに合わせて暗くする
 */
export class LetterReader {
  private readonly root: HTMLDivElement;
  private readonly paper: HTMLDivElement;
  private onClose: (() => void) | null = null;

  constructor() {
    const root = document.createElement('div');
    root.className = 'letter-reader';
    root.innerHTML = `<div class="letter-scrim"></div><div class="letter-paper" role="dialog" aria-label="手紙" tabindex="-1"></div>`;
    document.body.appendChild(root);
    keepToSelf(root);
    this.root = root;
    this.paper = root.querySelector('.letter-paper')!;
    root.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('shown');
  }

  /** 手紙を開く。onClose は閉じたとき */
  open(letter: Pick<Letter, 'kind' | 'topic' | 'pick'>, onClose?: () => void): void {
    const lines = letterLines(letter)
      .map((l) => `<p>${esc(l)}</p>`)
      .join('');
    this.paper.innerHTML = `${lines}<p class="sign">${esc(UNCLE.signature)}</p>`;
    this.onClose = onClose ?? null;
    this.root.classList.add('shown');
    this.paper.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('shown');
    const done = this.onClose;
    this.onClose = null;
    done?.();
  }

  /** 部屋の明るさに合わせた紙の明るさ（1 で昼） */
  setLum(lum: number): void {
    this.root.style.setProperty('--lum', lum.toFixed(3));
  }
}

/**
 * 机の上の封筒（最初の手紙）。瓶の横の天板の上に置いてあり、タップで読める。読んだら日誌のその日のページに留まる。
 * 置く所（画面の上の位置）は描画側が毎フレーム決める（瓶と一緒に動く）
 */
export class Envelope {
  private readonly el: HTMLButtonElement;
  private shown = false;

  constructor(onOpen: () => void) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'envelope';
    el.setAttribute('aria-label', '封筒');
    el.innerHTML = '<span class="paper"><span class="flap"></span></span>';
    el.addEventListener('click', () => onOpen());
    document.body.appendChild(el);
    keepToSelf(el);
    this.el = el;
  }

  /** 画面の上の位置（CSS px、封筒の真ん中）と大きさの倍率。null なら出さない */
  place(at: { x: number; y: number; scale: number } | null): void {
    const show = at !== null;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('shown', show);
    }
    if (at) this.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%) scale(${at.scale.toFixed(3)})`;
  }

  /** 部屋の明るさに合わせた紙の明るさ（1 で昼） */
  setLum(lum: number): void {
    this.el.style.setProperty('--lum', lum.toFixed(3));
  }
}
