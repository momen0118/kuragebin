// 泳ぐ個体の体（種によらない窓口）。ミズクラゲ（jelly/jellyfish.ts）とカブトクラゲ（cteno/ctenophore.ts）が持つ。
// 瓶の個体（creatures.ts）・カップ（scoop.ts）・スポイト（feeding.ts）・描く順番（app.ts）は、これだけを使う。
// 餌を食べる見せ場（food.ts）は、まだミズクラゲの体だけを相手にする
import type { Group, Matrix4, Vector3 } from 'three';
import type { Sex } from '../sim/state';
import type { Neighbor, Swimmer } from './jelly/swim';
import type { WaterField } from './slosh';
import type { Stomach } from './stomach';

export interface SwimBody {
  readonly group: Group;
  /** 位置・向き・速さと、泳ぎ方（瓶の中を泳ぐ、カップで運ばれる、カップから出ていく） */
  readonly swimmer: Swimmer;
  /** 胃の中の餌の見え方 */
  readonly stomach: Stomach;
  /** 作ったときの遺伝子（変わったら作り直す） */
  readonly genesKey: string;
  /** よけ合う大きさ（瓶の高さ単位） */
  readonly radius: number;
  /** 体の座標（位置・向き・大きさ） */
  readonly frame: Matrix4;
  /** 揺れのあと、起き直っている最中か */
  readonly righting: boolean;
  /** 光っているか（光る種だけ） */
  readonly glowing: boolean;
  /** 近くを泳ぐほかの個体と、揺らされた瓶の水（描画側が毎フレーム入れる） */
  neighbors: readonly Neighbor[];
  water: WaterField | null;

  /** 育ち具合・放されたときの大きさ・大きさの倍率 */
  setGrowth(growth: number, startRadius?: number, size?: number): void;
  /** 雌雄の見え方（雌雄のない種は何もしない） */
  setSex(sex: Sex | null, amount: number, brood: number): void;
  place(pos: Vector3, up: Vector3, vel: Vector3, mode?: 'cruise' | 'drift'): void;
  relocate(pos: Vector3): void;
  carry(target: Vector3 | null, stiff?: number, withWater?: boolean, up?: Vector3 | null): void;
  swimOut(base: Vector3, axis: Vector3, pulseDelay: number): void;
  letGo(vel: Vector3, mode: 'cruise' | 'drift'): void;
  flipForDebug(): void;
  translate(dx: number): void;
  setOpacity(a: number): void;
  setRenderOrder(base: number): void;
  /** 水面を揺らす強さ（0〜1。ミズクラゲは拍動で縮んでいる間） */
  stirRate(): number;
  /** 光る種の光が周りを照らす位置と色 */
  glowPosition(out: Vector3): Vector3;
  glowColor(out: Vector3): Vector3;
  /** ガラスをつつかれた。反応したら true */
  poke(point: Vector3): boolean;
  update(frameDt: number): void;
  dispose(): void;
}
