// 泳ぐカブトクラゲ一匹。体（body.ts）を、泳ぎ（jelly/swim.ts）の位置と向きに置く。
// 拍動はせず、櫛板が打ち続けてなめらかに進む（drive.ts）。頂を上にしたまま、ほとんど沈まずにゆっくり漂う。
// つつかれると口葉をきゅっと閉じ、櫛板を逆に打って少し後ずさる。揺れのあとは、平衡器で傾きを感じて櫛板でゆっくり起き直る。
// 幼生（触手のある小さな粒）は、丸い体に長い触手が2本。育つにつれて口葉が広がり、触手が縮んで成体の形になる。
// ローカルの +y が頂（平衡器のある側）で、泳ぎの「傘の頂点の向き」に合わせてある
import { Group, Matrix4, Vector3, type Material } from 'three';
import { CTENO, POKE, RENDER } from '../../config';
import { genesKey, type BolinopsisGenes } from '../../sim/genes';
import type { Rng } from '../../sim/rng';
import type { Sex } from '../../sim/state';
import type { RootFrame } from '../jelly/tentacles';
import { Swimmer, swimBounds, type Neighbor } from '../jelly/swim';
import type { WaterField } from '../slosh';
import { Stomach } from '../stomach';
import type { SwimBody } from '../swimBody';
import type { SharedUniforms } from '../uniforms';
import { createCtenoBody, type CtenoBody } from './body';
import { CombDrive } from './drive';
import { bodyPoint, ctenoForm, larvaNormal, larvaPoint, type CtenoForm } from './shape';
import { LarvaTentacles } from './tentacles';

const STEP = 1 / RENDER.simHz;

const smooth = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

export class Ctenophore implements SwimBody {
  readonly group = new Group();
  readonly swimmer: Swimmer;
  readonly stomach = new Stomach();
  readonly genesKey: string;
  readonly form: CtenoForm;
  readonly body: CtenoBody;
  neighbors: readonly Neighbor[] = [];
  water: WaterField | null = null;
  /** 泳ぎを押し出す櫛板 */
  private readonly drive: CombDrive;
  /** つつかれてからの時間（秒。口葉を閉じて開くまで）。つつかれていなければ null */
  private pokedFor: number | null = null;
  private pokeStrength = 0;
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3(CTENO.length, CTENO.length, CTENO.length);
  /** 幼生の触手と、その根元（ローカル。体の形が移るのに合わせて求めなおす） */
  private readonly tentacles: LarvaTentacles;
  private readonly rootLocal = [new Vector3(), new Vector3()];
  private readonly rootDirLocal = [new Vector3(), new Vector3()];
  private readonly root: RootFrame = { pos: new Vector3(), dir: new Vector3() };
  private readonly carryTarget = new Vector3();
  private readonly carryUp = new Vector3();
  private size = 1;
  private acc = 0;
  private cooldown = 0;
  /** 口葉の開閉の時間（個体ごとにずらす） */
  private swayT: number;

  constructor(shared: SharedUniforms, rng: Rng, genes: Readonly<BolinopsisGenes>, seed = 0, growth = 1, size = 1) {
    this.genesKey = genesKey(genes);
    this.form = ctenoForm(genes, seed);
    this.drive = new CombDrive(rng, this.form.tempo);
    const s = CTENO.swim;
    this.swimmer = new Swimmer(rng, swimBounds(), { sink: s.sink, tilt: s.tilt, turn: s.turn, upright: s.upright, leans: false });
    this.swayT = rng.range(0, CTENO.lobeSwayPeriod);
    this.body = createCtenoBody(shared, this.form, rng.range(0, 10));
    this.group.add(...this.body.meshes);
    this.tentacles = new LarvaTentacles(shared, { uBody: this.body.look.uBody, uGlow: { value: new Vector3() }, uOpacity: this.body.look.uOpacity }, rng);
    this.group.add(this.tentacles.mesh);
    this.setGrowth(growth, undefined, size);
    this.updateMatrix();
    this.sync();
  }

  get radius(): number {
    return CTENO.length * this.size * CTENO.avoid;
  }

  get frame(): Matrix4 {
    return this.matrix;
  }

  get righting(): boolean {
    return this.swimmer.isRighting;
  }

  /** 自分では光らない（櫛板の虹は光の反射） */
  get glowing(): boolean {
    return false;
  }

  /**
   * 育ち具合（幼生の段階の進み。成体は 1）と大きさの倍率。幼生の姿から成体の形へ移る割合と、触手の長さが決まる
   */
  setGrowth(growth: number, _startRadius?: number, size: number = this.size): void {
    this.size = size;
    this.scale.setScalar(CTENO.length * size);
    this.swimmer.setForm(this.radius, 0);
    const LV = CTENO.larva;
    const m = 1 - smooth((growth - LV.shape[0]) / (LV.shape[1] - LV.shape[0]));
    const reach = 1 - smooth((growth - LV.tentacles[0]) / (LV.tentacles[1] - LV.tentacles[0]));
    this.body.look.uLarva.value = m;
    this.tentacles.setLength(LV.tentacle.length * CTENO.length * size * reach, CTENO.length * size);
    // 触手の根元：丸い体の横（±z）。成体の形へ移るにつれて、胴の同じ所へ
    const th = LV.tentacle.rootTheta * Math.PI;
    const tmp = new Vector3();
    for (let i = 0; i < 2; i++) {
      const phi = i === 0 ? -Math.PI / 2 : Math.PI / 2;
      larvaPoint(th, phi, this.rootLocal[i]!).lerp(bodyPoint(this.form, LV.tentacle.rootTheta, phi, tmp), 1 - m);
      larvaNormal(th, phi, this.rootDirLocal[i]!).add(tmp.set(0, -LV.tentacle.droop, 0)).normalize();
    }
  }

  /** 雌雄同体なので何もしない */
  setSex(_sex: Sex | null, _amount: number, _brood: number): void {}

  place(pos: Vector3, up: Vector3, vel: Vector3, mode: 'cruise' | 'drift' = 'cruise'): void {
    this.swimmer.place(pos, up, vel, mode);
    this.tentacles.reset();
    this.updateMatrix();
    this.sync();
  }

  relocate(pos: Vector3): void {
    this.swimmer.pos.copy(pos);
    this.tentacles.reset();
    this.updateMatrix();
    this.sync();
  }

  /** カップの水の中で運ばれる。頂が水面から出ないよう、カップの真ん中より少し下（カップの軸に沿って）に置く */
  carry(target: Vector3 | null, stiff = 1, withWater = true, up: Vector3 | null = null): void {
    if (!target) {
      this.swimmer.carry(null, stiff, withWater, up);
      return;
    }
    const t = this.carryTarget.copy(target).addScaledVector(up ?? this.carryUp.set(0, 1, 0), -CTENO.carryDrop * this.size);
    this.swimmer.carry(t, stiff, withWater, up);
  }

  /** カップから櫛板の波ですーっと滑り出る */
  swimOut(base: Vector3, axis: Vector3, _pulseDelay: number): void {
    this.swimmer.guide(base, axis);
  }

  letGo(vel: Vector3, mode: 'cruise' | 'drift'): void {
    this.swimmer.letGo(vel, mode);
  }

  flipForDebug(): void {
    this.swimmer.flipForDebug();
    this.updateMatrix();
  }

  translate(dx: number): void {
    this.swimmer.translate(dx);
    this.tentacles.translate(dx);
    this.updateMatrix();
    this.sync();
  }

  setOpacity(a: number): void {
    this.body.look.uOpacity.value = a;
  }

  setRenderOrder(base: number): void {
    const [back, inner, plates, front] = this.body.meshes;
    back!.renderOrder = base;
    inner!.renderOrder = base + 0.1;
    plates!.renderOrder = base + 0.2;
    front!.renderOrder = base + 0.3;
    this.tentacles.mesh.renderOrder = base + 0.05;
  }

  /** 拍動しないので水面は揺らさない */
  stirRate(): number {
    return 0;
  }

  glowPosition(out: Vector3): Vector3 {
    return out.setFromMatrixPosition(this.matrix);
  }

  glowColor(out: Vector3): Vector3 {
    return out.set(0, 0, 0);
  }

  /** ガラスをつつかれた：近ければ口葉をきゅっと閉じ、櫛板を逆に打って少し後ずさる。反応したら true */
  poke(point: Vector3): boolean {
    if (this.cooldown > 0) return false;
    const d = point.distanceTo(this.swimmer.pos);
    const strength = 1 - Math.min(Math.max((d - POKE.fullRange) / (POKE.range - POKE.fullRange), 0), 1);
    if (strength <= 0) return false;
    this.drive.startle(strength);
    this.swimmer.flee(point, strength * CTENO.poke.flee);
    this.pokedFor = 0;
    this.pokeStrength = strength;
    this.cooldown = POKE.cooldown;
    return true;
  }

  update(frameDt: number): void {
    const dt = Math.min(frameDt, RENDER.maxFrameDt);
    this.acc += dt;
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swayT += dt;
    if (this.pokedFor !== null) {
      this.pokedFor += dt;
      if (this.pokedFor > CTENO.poke.closeTime + CTENO.poke.reopen) this.pokedFor = null;
    }
    this.stomach.update(dt);
    this.sync();
  }

  dispose(): void {
    for (const g of this.body.geometries) g.dispose();
    for (const m of this.body.meshes) (m.material as Material).dispose();
    this.tentacles.dispose();
  }

  private step(dt: number): void {
    this.drive.update(dt);
    const water = this.swimmer.isCarried || this.swimmer.isGuided ? null : this.water;
    this.swimmer.update(dt, this.drive, this.neighbors, water);
    // カップの水ごと運ばれている：触手も水と一緒に動く。瓶の壁の中に収めない
    const carried = this.swimmer.isCarried;
    this.tentacles.confined = !carried;
    const w = this.swimmer.carryShift;
    if (carried && w.lengthSq() > 0) this.tentacles.translate(w.x, w.y, w.z);
    this.updateMatrix();
    const M = this.matrix;
    this.tentacles.step(
      dt,
      (i) => {
        this.root.pos.copy(this.rootLocal[i]!).applyMatrix4(M);
        this.root.dir.copy(this.rootDirLocal[i]!).transformDirection(M);
        return this.root;
      },
      water,
    );
  }

  /** 口葉を閉じている割合（0〜1）：つつかれてすぐ閉じ、ゆっくり開いて戻る */
  private closed(): number {
    const t = this.pokedFor;
    if (t === null) return 0;
    const P = CTENO.poke;
    const k = t < P.closeTime ? Math.sin((Math.PI / 2) * (t / P.closeTime)) : 1 - smooth((t - P.closeTime) / P.reopen);
    return k * (0.5 + 0.5 * this.pokeStrength);
  }

  private updateMatrix(): void {
    this.matrix.compose(this.swimmer.pos, this.swimmer.quat, this.scale);
  }

  private sync(): void {
    this.updateMatrix();
    for (const m of this.body.meshes) m.matrix.copy(this.matrix);
    // 口葉はゆっくり開いたり閉じたりする（左右で少しずらす）。つつかれるときゅっと閉じる
    const w = (Math.PI * 2) / CTENO.lobeSwayPeriod;
    const a = CTENO.lobeSway;
    const close = this.closed() * CTENO.poke.close;
    this.body.look.uSway.value.set(a * Math.sin(this.swayT * w) - close, a * Math.sin(this.swayT * w + 0.7) - close);
    this.body.look.uBeatPhase.value = this.drive.beatPhase;
    this.tentacles.updateGeometry();
  }
}
