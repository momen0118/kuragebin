// 個体の札。海月（瓶底のポリプも）をタップすると数秒だけ出る。
// 図鑑や標本の注記のように、個体から細い線を斜め上へ引き、その先の短い横線の上に名前、下に小さく段階と日数。
// 線は瓶の縁や画面の外にはみ出さない側へ引く。名前（初めは「名無し」）をタップすると名前を付けられる。
import { TAG } from '../config';
import type { NoteAnchor } from '../render/app';
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
  /** 線を付ける所（CSS px、レンズ越しに見えている位置）。見えていなければ null */
  anchor(id: number): NoteAnchor | null;
  rename(id: number, name: string): void;
}

const SVG = 'http://www.w3.org/2000/svg';

/** 線の置き方（CSS px）：引きはじめ、折れる所、横線の向き（1 で右、-1 で左） */
interface Layout {
  ax: number;
  ay: number;
  ex: number;
  ey: number;
  dir: number;
  /** 瓶の縁・画面の端からはみ出す量 */
  over: number;
}

export class CreatureTag {
  private readonly el: HTMLDivElement;
  private readonly halo: SVGPathElement;
  private readonly line: SVGPathElement;
  private readonly nameEl: HTMLButtonElement;
  private readonly subEl: HTMLDivElement;
  private input: HTMLInputElement | null = null;
  private id: number | null = null;
  /** 出ている残りの時間と、消えていく残りの時間（秒） */
  private life = 0;
  private fading = 0;
  private dir = 1;
  /** 名前・段階の文字の大きさ（CSS px） */
  private nameW = 0;
  private nameH = 0;
  private subW = 0;
  private placed: Layout | null = null;

  constructor(private readonly opts: TagOptions) {
    const el = document.createElement('div');
    el.className = 'creature-note';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'lead');
    svg.setAttribute('width', '1');
    svg.setAttribute('height', '1');
    svg.setAttribute('aria-hidden', 'true');
    this.halo = document.createElementNS(SVG, 'path');
    this.halo.setAttribute('class', 'halo');
    this.line = document.createElementNS(SVG, 'path');
    this.line.setAttribute('class', 'line');
    svg.append(this.halo, this.line);
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'name';
    name.addEventListener('click', () => this.edit());
    const sub = document.createElement('div');
    sub.className = 'sub';
    el.append(svg, name, sub);
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
    const again = this.id === id;
    this.id = id;
    this.life = TAG.seconds;
    this.fading = 0;
    if (!this.render()) {
      this.hide();
      return;
    }
    if (!again) this.placed = null;
    this.el.classList.remove('quick');
    this.el.classList.add('shown');
    this.follow();
  }

  /** すぐに消す（瓶を切り替える、個体をすくうとき） */
  hide(): void {
    if (this.input) this.finishEdit(true);
    this.id = null;
    this.fading = 0;
    this.placed = null;
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
          this.placed = null;
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
    const n = this.input ?? this.nameEl;
    this.nameW = n.offsetWidth;
    this.nameH = n.offsetHeight;
    this.subW = this.subEl.offsetWidth;
  }

  /** 横線の長さ（文字の幅と前後の余り） */
  private get ruleLength(): number {
    return Math.max(this.nameW, this.subW) + TAG.rulePad * 2;
  }

  /** 向き dir で線を引いたときの置き方 */
  private layout(a: NoteAnchor, dir: number): Layout {
    const vw = window.innerWidth;
    const lo = Math.max(a.left, 0) + TAG.margin;
    const hi = Math.min(a.right, vw) - TAG.margin;
    // 引きはじめは傘の肩のあたり（ポリプは触手の冠の上）
    const ax = a.x + dir * a.r * TAG.startSide;
    const ay = a.y - a.r * TAG.startUp;
    // 名前が瓶の上端より上に出ないよう、近いときは線を短く
    const topLimit = Math.max(a.top, 0) + TAG.margin + this.nameH;
    let ey = ay - TAG.rise;
    if (ey < topLimit) ey = Math.min(ay - TAG.minRise, topLimit);
    const ex = ax + (dir * TAG.run * (ay - ey)) / TAG.rise;
    const end = ex + dir * this.ruleLength;
    const over = Math.max(0, lo - Math.min(ax, ex, end)) + Math.max(0, Math.max(ax, ex, end) - hi);
    return { ax, ay, ex, ey, dir, over };
  }

  /** 個体について動く（名前を入れている間は動かさない） */
  private follow(): void {
    if (this.id === null || this.input) return;
    const a = this.opts.anchor(this.id);
    if (!a) {
      this.hide();
      return;
    }
    // 初めて出すときは瓶の真ん中の側へ。はみ出すなら、はみ出さないほうへ向きを変える
    if (!this.placed) this.dir = a.x < (a.left + a.right) / 2 ? 1 : -1;
    let l = this.layout(a, this.dir);
    if (l.over > 0) {
      const other = this.layout(a, -this.dir);
      if (other.over + 2 < l.over) {
        l = other;
        this.dir = other.dir;
      }
    }
    this.place(l);
  }

  private place(l: Layout): void {
    this.placed = l;
    const w = this.ruleLength;
    const dx = l.ax - l.ex;
    const dy = l.ay - l.ey;
    const d = `M${dx.toFixed(1)} ${dy.toFixed(1)}L0 0L${(l.dir * w).toFixed(1)} 0`;
    this.line.setAttribute('d', d);
    this.halo.setAttribute('d', d);
    this.el.style.transform = `translate(${l.ex.toFixed(1)}px, ${l.ey.toFixed(1)}px)`;
    const pad = TAG.rulePad;
    const name = this.input ?? this.nameEl;
    const nx = l.dir > 0 ? pad : -pad - this.nameW;
    const sx = l.dir > 0 ? pad : -pad - this.subW;
    name.style.transform = `translate(${nx.toFixed(1)}px, ${(-this.nameH - 1).toFixed(1)}px)`;
    this.subEl.style.transform = `translate(${sx.toFixed(1)}px, 3px)`;
  }

  /** 名前を入れる */
  private edit(): void {
    if (this.id === null || this.input || !this.placed) return;
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
    this.el.classList.add('editing', 'shown');
    this.measure();
    // キーボードに隠れないよう、横線を画面の上のほうへ（線は個体から伸ばしたまま）
    const p = this.placed;
    this.place({ ...p, ey: Math.min(p.ey, window.innerHeight * TAG.editMaxY) });
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
