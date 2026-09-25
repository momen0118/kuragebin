// 海月一匹。拍動・泳ぎ・触手・口腕を固定刻みで進め、描画用のデータにまとめる。
import { Group, Matrix4, Vector3 } from 'three';
import { BELL, JELLY_LOOK, ORAL_ARMS, PULSE, RENDER, TENTACLES } from '../../config';
import type { Rng } from '../../sim/rng';
import type { SharedUniforms } from '../uniforms';
import { createBell, type Bell, type BellLook } from './bell';
import { OralArms } from './oralArms';
import { bellProfile, marginTangent, notch } from './profile';
import { Pulse } from './pulse';
import { Swimmer } from './swim';
import { Tentacles, type RootFrame } from './tentacles';

const STEP = 1 / RENDER.simHz;

export class Jellyfish {
  readonly group = new Group();
  readonly pulse: Pulse;
  readonly swimmer: Swimmer;
  readonly look: BellLook;
  readonly bell: Bell;
  readonly tentacles: Tentacles;
  readonly arms: OralArms;
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3(BELL.radius, BELL.radius, BELL.radius);
  private acc = 0;
  private readonly root: RootFrame = { pos: new Vector3(), dir: new Vector3() };
  private readonly radialTmp = new Vector3();
  private readonly jet = new Vector3();
  private readonly center = new Vector3();

  constructor(shared: SharedUniforms, rng: Rng) {
    this.pulse = new Pulse(rng);
    this.swimmer = new Swimmer(rng);
    this.look = {
      uBody: { value: new Vector3(...JELLY_LOOK.body) },
      uGlow: { value: new Vector3(...JELLY_LOOK.glow) },
      uGonad: { value: new Vector3(...JELLY_LOOK.gonad) },
    };
    this.bell = createBell(shared, this.look);
    this.tentacles = new Tentacles(shared, this.look, rng);
    this.arms = new OralArms(shared, this.look, rng);
    this.group.add(this.tentacles.mesh, this.arms.mesh, ...this.bell.meshes);
    this.updateMatrix();
    this.step(0);
    this.sync();
  }

  /** 時刻による発光の強さを反映する */
  setGlow(strength: number): void {
    const k = strength * JELLY_LOOK.glowStrength;
    this.look.uGlow.value.set(...JELLY_LOOK.glow).multiplyScalar(k);
    this.look.uGonad.value.set(...JELLY_LOOK.gonad).multiplyScalar(k);
  }

  /** 光が周りを照らす位置（ワールド） */
  glowPosition(out: Vector3): Vector3 {
    return out.set(0, JELLY_LOOK.lightCenterY, 0).applyMatrix4(this.matrix);
  }

  update(frameDt: number): void {
    this.acc += Math.min(frameDt, RENDER.maxFrameDt);
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.sync();
  }

  private updateMatrix(): void {
    this.matrix.compose(this.swimmer.pos, this.swimmer.quat, this.scale);
  }

  private step(dt: number): void {
    if (dt > 0) {
      this.pulse.update(dt);
      this.swimmer.update(dt, this.pulse);
    }
    this.updateMatrix();
    const M = this.matrix;
    const pMargin = this.pulse.value(PULSE.marginLag);
    const [mr, my] = bellProfile(1, pMargin);
    const [tr, ty] = marginTangent(pMargin);
    // 触手は縁から、少し外へ開きながら下へ垂れる
    let dr = tr + TENTACLES.splayOut;
    let dy = ty - TENTACLES.splayDown;
    const dl = Math.hypot(dr, dy) || 1;
    dr /= dl;
    dy /= dl;
    const axis = this.swimmer.axis;
    this.center.setFromMatrixPosition(M);
    const rate = Math.max(this.pulse.rate(), 0);
    this.jet.copy(axis).multiplyScalar(-TENTACLES.jet * rate);
    const root = this.root;
    const angles = this.tentacles.angles;
    this.tentacles.step(
      dt,
      (i) => {
        const th = angles[i]!;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const r = mr * notch(th, 1);
        root.pos.set(r * c, my, r * s).applyMatrix4(M);
        root.dir.set(dr * c, dy, dr * s).transformDirection(M);
        return root;
      },
      this.jet,
      this.center,
    );

    const armAngles = this.arms.angles;
    const armJet = this.radialTmp.copy(axis).multiplyScalar(-ORAL_ARMS.jet * rate);
    const radial = new Vector3();
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
        return radial.set(-Math.sin(th), 0, Math.cos(th)).transformDirection(M);
      },
      armJet,
      this.center,
    );
  }

  private sync(): void {
    for (const m of this.bell.meshes) m.matrix.copy(this.matrix);
    const lag = PULSE.marginLag;
    this.bell.pulse.value.set(this.pulse.value(0), this.pulse.value(lag * 0.5), this.pulse.value(lag));
    this.tentacles.updateGeometry();
    this.arms.updateGeometry();
  }
}
