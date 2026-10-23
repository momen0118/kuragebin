// カブトクラゲの泳ぎを押し出すもの。拍動せず、櫛板が打ち続けてなめらかに進む。
// 泳ぎ（jelly/swim.ts）から調子を受け取り、押し出す強さをなめらかに変える。つつかれると、しばらく櫛板を逆に打つ。
// 櫛板の波の進み（描画の位相）も、ここで押し出す強さに合わせて進める
import { CTENO } from '../../config';
import type { Rng } from '../../sim/rng';
import type { Propulsion } from '../jelly/swim';

const S = CTENO.swim;
const P = CTENO.poke;

export class CombDrive implements Propulsion {
  /** 打ち続けるので、縮む瞬間はない */
  readonly contracting = false;
  /** 今の押し出す強さと、目指す強さ（調子から） */
  private effort: number = S.drift;
  private target: number = S.drift;
  /** 逆に打っている残りの時間（秒）と、そのときの強さ */
  private reverseLeft = 0;
  private reverseStrength = 0;
  /** 櫛板の波の位相（1 で波ひとつ分進む）。描画に渡す */
  private phase: number;
  private time = 0;
  private readonly wobblePhase: number;

  /** tempo は個体差（櫛板を打つ速さの倍率） */
  constructor(
    rng: Rng,
    private readonly tempo = 1,
  ) {
    this.phase = rng.range(0, 10);
    this.wobblePhase = rng.range(0, Math.PI * 2);
  }

  /** 泳ぎの調子：休みがあれば漂う調子、なければ上へ泳ぐ（起き直るとき・カップから出るときも泳ぐ調子） */
  setStyle(_amp: number, rest: number, _tempo: number): void {
    this.target = rest > 0 ? S.drift : S.cruise;
  }

  thrustRate(): number {
    // 逆に打っている間は、前へは押さない（後ずさるのは離れる勢いで）
    if (this.reverseLeft > 0) return 0;
    const wobble = 1 + S.wobble * Math.sin(this.time * 0.7 + this.wobblePhase) * Math.sin(this.time * 0.23);
    return this.effort * this.tempo * wobble;
  }

  /** つつかれた：しばらく櫛板を逆に打つ（strength は 0〜1） */
  startle(strength: number): void {
    this.reverseLeft = P.reverseTime * (0.6 + 0.4 * strength);
    this.reverseStrength = P.reverse * strength;
  }

  /** 次の一打を早める（拍動のための窓口。打ち続けるので何もしない） */
  soon(_delay: number): void {}

  /** 櫛板を打つ速さ（1秒に打つ回数。負なら逆に打っている） */
  beatRate(): number {
    const base = CTENO.beatRate * this.tempo;
    if (this.reverseLeft > 0) return -base * (0.5 + this.reverseStrength);
    const k = Math.min(this.effort / S.cruise, 1);
    return base * (S.beatIdle + (1 - S.beatIdle) * k);
  }

  /** 櫛板の波の位相 */
  get beatPhase(): number {
    return this.phase;
  }

  update(dt: number): void {
    this.time += dt;
    this.effort += (this.target - this.effort) * (1 - Math.exp(-dt / S.ease));
    this.phase += this.beatRate() * dt;
    if (this.reverseLeft > 0) {
      this.reverseLeft -= dt;
      // 逆に打ったあとは、ゆっくりから打ちはじめる
      if (this.reverseLeft <= 0) this.effort = S.drift * 0.3;
    }
  }
}
