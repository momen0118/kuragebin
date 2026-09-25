// 泳ぐ海月一匹（成体とエフィラ）。拍動・泳ぎ・触手・口腕を固定刻みで進め、描画用のデータにまとめる。
// 育ち具合（0 で放されたばかりのエフィラ、1 で成体）で形と動きが変わる（form.ts）。
import { Group, Matrix4, Vector3, type BufferGeometry, type Material } from 'three';
import { BELL, EPHYRA, JELLY_LOOK, ORAL_ARMS, POKE, RENDER, TENTACLES } from '../../config';
import type { Rng } from '../../sim/rng';
import type { SharedUniforms } from '../uniforms';
import { createBell, type Bell, type BellLook } from './bell';
import { ADULT_FORM, armReach, formAt, pulseParams, shapeParams, type JellyForm } from './form';
import { OralArms } from './oralArms';
import { BellShape, LOBES } from './profile';
import { Pulse } from './pulse';
import { Swimmer, type Neighbor } from './swim';
import { Tentacles, type RootFrame } from './tentacles';

const STEP = 1 / RENDER.simHz;

export class Jellyfish {
  readonly group = new Group();
  readonly pulse: Pulse;
  readonly swimmer: Swimmer;
  readonly look: BellLook;
  readonly bell: Bell;
  readonly shape: BellShape;
  readonly tentacles: Tentacles;
  readonly arms: OralArms;
  /** 近くを泳ぐほかの個体（よけるため。描画側が毎フレーム入れる） */
  neighbors: readonly Neighbor[] = [];
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3(BELL.radius, BELL.radius, BELL.radius);
  private form: JellyForm = ADULT_FORM;
  private growth = -1;
  private startRadius: number = EPHYRA.radius;
  private acc = 0;
  /** つつかれた直後の光（0〜1、だんだん消える）。光る種だけが使う */
  private flash = 0;
  /** 今の発光の強さ（0 なら光っていない） */
  private glowNow = 0;
  private cooldown = 0;
  private readonly root: RootFrame = { pos: new Vector3(), dir: new Vector3() };
  private readonly radial = new Vector3();
  private readonly jet = new Vector3();
  private readonly armJet = new Vector3();
  private readonly center = new Vector3();
  private readonly edge = { r: 0, y: 0, tr: 0, ty: 0 };

  constructor(shared: SharedUniforms, rng: Rng, growth = 1, startRadius: number = EPHYRA.radius) {
    this.pulse = new Pulse(rng);
    this.swimmer = new Swimmer(rng);
    this.shape = new BellShape(rng);
    this.look = {
      uBody: { value: new Vector3(...JELLY_LOOK.body) },
      uGlow: { value: new Vector3(...JELLY_LOOK.glow) },
      uGonad: { value: new Vector3(...JELLY_LOOK.gonad) },
    };
    this.bell = createBell(shared, this.look);
    this.tentacles = new Tentacles(shared, this.look, rng);
    this.arms = new OralArms(shared, this.look, rng);
    this.group.add(this.tentacles.mesh, this.arms.mesh, ...this.bell.meshes);
    this.setGrowth(growth, startRadius);
    this.updateMatrix();
    this.step(0);
    this.sync();
  }

  /** 光っているか（ミズクラゲは光らない。光る種を加えたときに発光の描画をする） */
  get glowing(): boolean {
    return this.glowNow > 1e-4;
  }

  /** 傘の半径（瓶の高さ単位、腕の先まで） */
  get radius(): number {
    return this.form.radius;
  }

  /**
   * 育ち具合（0 で放されたばかりのエフィラ、1 で成体）。startRadius は放されたときの半径。
   * 大きさ・腕の形・触手と口腕・四つ葉・拍動と泳ぎの調子がまとめて変わる
   */
  setGrowth(g: number, startRadius: number = this.startRadius): void {
    if (g === this.growth && startRadius === this.startRadius) return;
    this.growth = g;
    this.startRadius = startRadius;
    const f = formAt(g, startRadius);
    this.form = f;
    this.scale.setScalar(f.radius);
    const u = this.bell.form;
    u.uArmDepth.value = f.armDepth;
    u.uArmBase.value = f.armBase;
    u.uArmTip.value = f.armTip;
    u.uLappet.value = f.lappet;
    u.uCanals.value = f.canals;
    u.uGonads.value = f.gonads;
    u.uYoung.value = f.jerk;
    this.bell.gonadMesh.visible = f.gonads > 0.01;
    this.tentacles.setForm(f.radius, f.tentacles);
    this.tentacles.mesh.visible = f.tentacles > 0;
    this.arms.setForm(f.radius, f.oralArms);
    this.pulse.setParams(pulseParams(f.jerk));
    this.shape.setParams(shapeParams(f.jerk));
    this.swimmer.setForm(f.radius, f.jerk);
  }

  /** 位置と向きを決めなおす（ストロビラから離れたばかりのエフィラ）。触手と口腕は根元から伸ばしなおす */
  place(pos: Vector3, up: Vector3, vel: Vector3): void {
    this.swimmer.place(pos, up, vel);
    // 離れたばかりは腕を畳んでいて、ゆっくり開く
    this.pulse.startle(0.8);
    this.tentacles.reset();
    this.arms.reset();
    this.updateMatrix();
    this.step(0);
    this.sync();
  }

  /** 描く順番（奥の個体から先に描く）。base から少しずつ */
  setRenderOrder(base: number): void {
    this.tentacles.mesh.renderOrder = base;
    this.arms.mesh.renderOrder = base + 0.1;
    this.bell.meshes.forEach((m, i) => (m.renderOrder = base + 0.2 + i * 0.1));
  }

  /** 光る種の光が周りを照らす位置（ワールド） */
  glowPosition(out: Vector3): Vector3 {
    return out.set(0, JELLY_LOOK.lightCenterY, 0).applyMatrix4(this.matrix);
  }

  /**
   * ガラスをつつかれた。近ければきゅっと縮んで離れ、数秒かけて緩む。光も一瞬強まる。
   * point はつついたガラスの位置（ワールド）。反応したら true
   */
  poke(point: Vector3): boolean {
    if (this.cooldown > 0) return false;
    const d = point.distanceTo(this.swimmer.pos);
    const strength = 1 - Math.min(Math.max((d - POKE.fullRange) / (POKE.range - POKE.fullRange), 0), 1);
    if (strength <= 0) return false;
    this.pulse.startle(strength);
    this.swimmer.flee(point, strength);
    this.flash = Math.max(this.flash, strength);
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
    this.flash *= Math.exp(-dt / POKE.flashDecay);
    this.sync();
  }

  /** 描画の資源を手放す（瓶から個体がいなくなったとき） */
  dispose(): void {
    const geos = new Set<BufferGeometry>();
    for (const m of [...this.bell.meshes, this.tentacles.mesh, this.arms.mesh]) {
      geos.add(m.geometry);
      (m.material as Material).dispose();
    }
    for (const g of geos) g.dispose();
    this.bell.profile.dispose();
  }

  private updateMatrix(): void {
    this.matrix.compose(this.swimmer.pos, this.swimmer.quat, this.scale);
  }

  private step(dt: number): void {
    if (dt > 0) {
      this.pulse.update(dt);
      this.swimmer.update(dt, this.pulse, this.neighbors);
    }
    this.shape.update(dt, this.pulse);
    this.updateMatrix();
    const M = this.matrix;
    const f = this.form;
    // 小さな個体では、水の押し出しも大きさに合わせて弱い（同じ形で縮めた動き）
    const k = f.radius / BELL.radius;
    const axis = this.swimmer.axis;
    this.center.setFromMatrixPosition(M);
    const rawRate = this.pulse.rate();
    const rate = Math.max(rawRate, 0);
    this.jet.copy(axis).multiplyScalar(-TENTACLES.jet * rate * k);
    // 緩むときは傘の下へ水が吸い込まれ、触手も少し引き寄せられる
    const inflow = TENTACLES.inflow * Math.max(-rawRate, 0) * k;
    const root = this.root;
    const angles = this.tentacles.angles;
    const edge = this.edge;
    this.tentacles.step(
      dt,
      (i) => {
        const th = angles[i]!;
        const c = Math.cos(th);
        const s = Math.sin(th);
        // 触手はその角度の縁から、少し外へ開きながら下へ垂れる（エフィラの腕の間では、縁は傘の途中）
        this.shape.pointAt(th, armReach(th, f, LOBES), edge);
        let dr = edge.tr + TENTACLES.splayOut;
        let dy = edge.ty - TENTACLES.splayDown;
        const dl = Math.hypot(dr, dy) || 1;
        dr /= dl;
        dy /= dl;
        root.pos.set(edge.r * c, edge.y, edge.r * s).applyMatrix4(M);
        root.dir.set(dr * c, dy, dr * s).transformDirection(M);
        return root;
      },
      this.jet,
      this.center,
      inflow,
    );

    const armAngles = this.arms.angles;
    this.armJet.copy(axis).multiplyScalar(-ORAL_ARMS.jet * rate * k);
    this.arms.step(
      dt,
      (i) => {
        const th = armAngles[i]!;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const rr = ORAL_ARMS.rootRadius;
        root.pos.set(rr * c, ORAL_ARMS.rootHeight, rr * s).applyMatrix4(M);
        root.dir.set(ORAL_ARMS.splay * c, -1, ORAL_ARMS.splay * s).transformDirection(M);
        return root;
      },
      (i) => {
        const th = armAngles[i]!;
        return this.radial.set(-Math.sin(th), 0, Math.cos(th)).transformDirection(M);
      },
      this.armJet,
      this.center,
    );
  }

  private sync(): void {
    for (const m of this.bell.meshes) m.matrix.copy(this.matrix);
    (this.bell.profile.image.data as Float32Array).set(this.shape.points);
    this.bell.profile.needsUpdate = true;
    this.bell.contract.value = this.pulse.value(BELL.propagation);
    // 発光：いつもの光と、つついた直後だけの光（ミズクラゲはどちらも 0）
    const k = JELLY_LOOK.glowStrength + JELLY_LOOK.pokeGlow * this.flash;
    this.glowNow = k;
    this.look.uGlow.value.set(...JELLY_LOOK.glow).multiplyScalar(k);
    this.look.uGonad.value.set(...JELLY_LOOK.gonad).multiplyScalar(k);
    this.tentacles.updateGeometry();
    this.arms.updateGeometry();
  }
}
