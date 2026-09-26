// 個体の札。海月（瓶底のポリプも）をタップすると、その上に小さく出て、数秒で消える。
// 名前・段階・この瓶に来てからの日数。名前（初めは「名無し」）をタップすると名前を付けられる。
import { TAG } from '../config';
import { NAME_MAX } from '../sim/actions';
import type { Stage } from '../sim/state';
import { STAGE_LABELS, UNNAMED } from './labels';

export interface TagInfo {
  name: string | null;
  stage: Stage;
  /** この瓶に来て何日目か（来た日が 1） */
  day: number;
}

export interface TagOptions {
  /** 表示中の瓶にいる個体の情報。いなければ null */
  info(id: number): TagInfo | null;
  /** 札を出す位置（CSS px、個体のすぐ上）。見えていなければ null */
  anchor(id: number): [number, number] | null;
  rename(id: number, name: string): void;
}

/** 画面の端から離す幅（CSS px） */
const MARGIN = 12;

export class CreatureTag {
  private readonly el: HTMLDivElement;
  private readonly nameEl: HTMLButtonElement;
  private readonly subEl: HTMLDivElement;
  private input: HTMLInputElement | null = null;
  private id: number | null = null;
  /** 出ている残りの時間と、消えていく残りの時間（秒） */
  private life = 0;
  private fading = 0;
  private width = 0;
  private height = 0;
  private x = 0;
  private y = 0;

  constructor(private readonly opts: TagOptions) {
    const el = document.createElement('div');
    el.className = 'creature-tag';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'name';
    name.addEventListener('click', () => this.edit());
    const sub = document.createElement('div');
    sub.className = 'sub';
    el.append(name, sub);
    document.body.appendChild(el);
    this.el = el;
    this.nameEl = name;
    this.subEl = sub;
  }

  /** 出している個体 */
  get shownId(): number | null {
    return this.id;
  }

  /** 個体 id の札を出す（出ていれば出しなおす） */
  show(id: number): void {
    if (this.input) this.finishEdit(true);
    this.id = id;
    this.life = TAG.seconds;
    this.fading = 0;
    if (!this.render()) {
      this.hide();
      return;
    }
    this.el.classList.remove('quick');
    this.el.classList.add('shown');
    this.follow();
  }

  /** すぐに消す（瓶を切り替える、個体をつまむとき） */
  hide(): void {
    if (this.input) this.finishEdit(true);
    this.id = null;
    this.fading = 0;
    this.el.classList.add('quick');
    this.el.classList.remove('shown');
  }

  /** 状態が変わった（名前・段階・日数を出しなおす。いなくなっていたら消す） */
  refresh(): void {
    if (this.id === null || this.input) return;
    if (!this.render()) this.hide();
  }

  /** 毎フレーム：個体について動き、時間が来たら消える */
  update(dt: number): void {
    if (this.id === null) return;
    if (!this.input) {
      if (this.life > 0) {
        this.life -= dt;
        if (this.life <= 0) {
          this.fading = TAG.fadeSeconds;
          this.el.classList.remove('shown');
        }
      } else {
        this.fading -= dt;
        if (this.fading <= 0) {
          this.id = null;
          return;
        }
      }
    }
    this.follow();
  }

  /** 中身を書く。個体がいなければ false */
  private render(): boolean {
    if (this.id === null) return false;
    const info = this.opts.info(this.id);
    if (!info) return false;
    const name = info.name ?? UNNAMED;
    const sub = `${STAGE_LABELS[info.stage]}・この瓶で${info.day}日目`;
    if (this.nameEl.textContent !== name || this.subEl.textContent !== sub) {
      this.nameEl.textContent = name;
      this.nameEl.classList.toggle('unnamed', info.name === null);
      this.subEl.textContent = sub;
      this.measure();
    }
    return true;
  }

  private measure(): void {
    this.width = this.el.offsetWidth;
    this.height = this.el.offsetHeight;
  }

  /** 個体のすぐ上へ（名前を入れている間は動かさない） */
  private follow(): void {
    if (this.id === null || this.input) return;
    const at = this.opts.anchor(this.id);
    if (!at) {
      this.hide();
      return;
    }
    this.moveTo(at[0], at[1] - TAG.offsetPx);
  }

  /** 札の下端の真ん中を (x, bottom) に置く。画面からはみ出さないように */
  private moveTo(x: number, bottom: number): void {
    const vw = window.innerWidth;
    this.x = Math.min(Math.max(x - this.width / 2, MARGIN), Math.max(vw - this.width - MARGIN, MARGIN));
    this.y = Math.max(bottom - this.height, MARGIN);
    this.el.style.transform = `translate(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px)`;
  }

  /** 名前を入れる */
  private edit(): void {
    if (this.id === null || this.input) return;
    const info = this.opts.info(this.id);
    if (!info) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name';
    input.value = info.name ?? '';
    input.placeholder = UNNAMED;
    input.maxLength = NAME_MAX;
    input.enterKeyHint = 'done';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', '名前');
    input.addEventListener('keydown', (e) => {
      // かな漢字変換の確定の Enter では閉じない
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.finishEdit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEdit(false);
      }
    });
    input.addEventListener('blur', () => this.finishEdit(true));
    this.nameEl.replaceWith(input);
    this.input = input;
    this.el.classList.add('editing');
    this.el.classList.add('shown');
    this.measure();
    // キーボードに隠れないよう、画面の上のほうへ
    const cx = this.x + this.width / 2;
    const bottom = Math.min(this.y + this.height, window.innerHeight * TAG.editMaxY);
    this.moveTo(cx, bottom);
    input.focus();
    input.select();
  }

  private finishEdit(save: boolean): void {
    const input = this.input;
    if (!input) return;
    this.input = null;
    input.replaceWith(this.nameEl);
    this.el.classList.remove('editing');
    if (save && this.id !== null) this.opts.rename(this.id, input.value);
    this.life = TAG.seconds;
    this.fading = 0;
    if (this.id !== null && !this.render()) this.hide();
    else this.measure();
  }
}
