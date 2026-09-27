// 胃の中の餌の見え方（描画側）。sim の餌（食べた時刻と量）から、時間とともに薄れる濃さを出す。
// 餌をやった瓶を見ているときは見せ場になり、粒を実際に食べて見せるたびに濃くなる。
// 見せ場が終わっても食べきっていなければ、残りは少しずつ濃くして、食べた量の分に合わせる。
import { FOOD, STOMACH } from '../config';
import type { Meal } from '../sim/state';

/** 食べてからの時間（秒、ゲーム内）に対する濃さの割合。しばらくはそのまま、そのあと薄れて消える */
export function digestAt(since: number): number {
  if (!(since >= 0)) return 0;
  const t = Math.min(Math.max((since - STOMACH.holdSeconds) / (STOMACH.fadeSeconds - STOMACH.holdSeconds), 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

export class Stomach {
  /** 見せている餌の時刻（sim の meal.at）と量。食べていなければ null */
  private at: number | null = null;
  private meal = 0;
  /** 消化の進み具合から決まる割合（1 で食べたて） */
  private digest = 0;
  /** その餌のうち見せた割合。見せ場の間は 0 から、粒が胃に届くたびに増える */
  private shown = 1;
  /** 見せ場：食べる粒の数（見せ場でなければ 0）、捕まえた数（運んでいる途中も含む）、胃に届いた数 */
  private bites = 0;
  private caught = 0;
  private eaten = 0;
  /** 見せ場が終わって、残りを少しずつ濃くしている */
  private settling = false;

  /** sim の餌に合わせる。time はゲーム内の今。見せ場でなければ、新しい餌はすぐに見せる */
  sync(meal: Meal | null, time: number): void {
    if (!meal) {
      this.at = null;
      this.meal = 0;
      this.digest = 0;
      this.shown = 1;
      this.bites = 0;
      this.settling = false;
      return;
    }
    if (meal.at !== this.at) {
      this.at = meal.at;
      this.meal = meal.amount;
      this.shown = 1;
      this.bites = 0;
      this.settling = false;
    }
    this.digest = digestAt(time - meal.at);
  }

  /** 食べた量（1 で満腹）。食べていなければ 0 */
  get amount(): number {
    return this.at === null ? 0 : this.meal;
  }

  /** 見せ場を始める（餌 at を食べたところなら）。bites 粒が胃に届くと、食べた量の分まで濃くなる */
  begin(at: number, bites: number): boolean {
    if (this.at !== at) return false;
    this.bites = Math.max(1, Math.round(bites));
    this.caught = 0;
    this.eaten = 0;
    this.shown = 0;
    this.settling = false;
    return true;
  }

  /** 見せ場の最中で、まだ粒を捕まえられる */
  get hungry(): boolean {
    return this.bites > 0 && !this.settling && this.caught < this.bites;
  }

  /** 見せ場で食べる粒の数（見せ場でなければ 0） */
  get biteCount(): number {
    return this.bites;
  }

  /** 粒を1つ捕まえた */
  catch(): void {
    this.caught++;
  }

  /** 捕まえた粒が胃に届いた */
  eat(): void {
    if (this.bites <= 0) return;
    this.eaten++;
    this.shown = Math.max(this.shown, Math.min(1, this.eaten / this.bites));
  }

  /** 見せ場を終える。immediate ならすぐ、そうでなければ残りを少しずつ濃くする */
  end(immediate: boolean): void {
    if (this.bites <= 0) return;
    if (immediate) {
      this.shown = 1;
      this.bites = 0;
      this.settling = false;
    } else {
      this.settling = true;
    }
  }

  update(dt: number): void {
    if (!this.settling) return;
    this.shown = Math.min(1, this.shown + dt / FOOD.catchUpSeconds);
    if (this.shown >= 1) {
      this.settling = false;
      this.bites = 0;
    }
  }

  /** 今の濃さ（1 で食べたての満腹） */
  get level(): number {
    return this.at === null ? 0 : this.meal * this.digest * this.shown;
  }
}
