// 描画のまとめ役。
// 1. 背景：部屋の写真に天板の影や光を重ねる
// 2. 中身：瓶の中（奥のガラス・瓶底・マリンスノー・海月・泡・水面）を透明な画像に描く
// 3. 発光：海月の光る部分だけを描いてブルームにする
// 4. 画面へ：背景を出し、最後に手前のガラスが背景と中身をレンズとして曲げて重ねる
import {
  Matrix4,
  PerspectiveCamera,
  Ray,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { BELL, JAR, LAMP, PHOTO, RENDER, RIM_WARM, WATER, type PhotoName } from '../config';
import { createRng } from '../sim/rng';
import type { JarState } from '../sim/state';
import { Bloom } from './bloom';
import { coverTransform, solvePhotoCamera, type PhotoCamera } from './camera';
import { createComposite } from './composite';
import { FullscreenPass } from './fullscreen';
import { Creatures } from './creatures';
import { createJar, type Jar } from './jar';
import type { Jellyfish } from './jelly/jellyfish';
import { lightAt, type LightState } from './lighting';
import { Bubble, createSnow } from './particles';
import { Room } from './room';
import { createTable } from './table';
import { chooseTargetType, createTarget } from './targets';
import { createSharedUniforms, type SharedUniforms } from './uniforms';

/** 発光パスで描くもの */
const GLOW_LAYER = 1;
/** 水面を揺らす強さの基準（成体の傘の半径） */
const RENDER_ADULT_RADIUS = BELL.radius;

const COPY = /* glsl */ `
uniform sampler2D tSrc;
in vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, 1.0); }
`;

/** タップの結果 */
export type TapResult = 'poke' | 'jelly' | 'none';

export class App {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly shared: SharedUniforms = createSharedUniforms();
  private readonly photoCam: PhotoCamera = solvePhotoCamera();
  private readonly bgScene = new Scene();
  private readonly contentScene = new Scene();
  private readonly glassScene = new Scene();
  private readonly room: Room;
  private readonly jar: Jar;
  /** 表示中の瓶の個体 */
  readonly creatures: Creatures;
  private readonly bubble: Bubble;
  private readonly bloom = new Bloom(RENDER.bloomLevels);
  private readonly composite;
  private readonly copy = new FullscreenPass(COPY, { tSrc: { value: null as Texture | null } });
  private roomRT: WebGLRenderTarget;
  /** 写真全体（画面の外も含む）。瓶の縁のレンズが画面の外を映すときに読む */
  private readonly roomWideRT: WebGLRenderTarget;
  private bgRT: WebGLRenderTarget;
  private contentRT: WebGLRenderTarget;
  private glowRT: WebGLRenderTarget;
  private width = 1;
  private height = 1;
  private roomDirty = true;
  private light: LightState = lightAt(12, { sunrise: 6, sunset: 18 });
  private time = 0;
  private fade = 0;
  /** 水面の揺れ（0〜1）。拍動やつつきで立ち、ゆっくり収まる */
  private agitation = 0;
  /** 夜のデスクライト：使うかどうか（利用者の切り替え、初期はオン）と、今の点き具合（0〜1） */
  private lampOn = true;
  private lampLevel = 0;
  private lampReady = false;
  private readonly tmpV = new Vector3();
  private readonly tmpV2 = new Vector3();
  private readonly tmpM = new Matrix4();
  private readonly ray = new Ray();
  /** 確認用：中間の画像をそのまま出す（'bg' | 'contents' | 'glow' | 'room'） */
  debugView: string | null = null;
  /** 確認用：部品ごとに表示を切り替える */
  readonly parts: Record<string, Object3D>;
  /** デバイスピクセル比の上限（確認用の撮影で上げられる） */
  maxDpr: number = RENDER.maxDpr;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(RENDER.clearColor, 1);
    chooseTargetType(this.renderer);
    this.roomRT = createTarget(1, 1);
    this.roomWideRT = createTarget(PHOTO.width / 2, PHOTO.height / 2, true);
    this.bgRT = createTarget(1, 1);
    this.contentRT = createTarget(1, 1);
    this.glowRT = createTarget(1, 1);

    const pc = this.photoCam;
    this.room = new Room(this.shared, pc);
    this.camera = new PerspectiveCamera(pc.vFovDeg, 1, 0.05, 20);
    this.camera.position.set(...pc.position);
    this.camera.rotation.set(-pc.pitch, 0, 0);
    this.camera.updateMatrixWorld();

    const rng = createRng(RENDER.seed);
    this.jar = createJar(this.shared, RIM_WARM.color);
    this.creatures = new Creatures(this.shared, GLOW_LAYER);
    this.bubble = new Bubble(this.shared, rng);

    const table = createTable(this.shared, pc);
    const snow = createSnow(this.shared, rng);
    this.bgScene.add(table);
    this.contentScene.add(this.jar.back, this.jar.floor, snow, this.creatures.group, this.bubble.points, this.jar.surface);
    this.glassScene.add(this.jar.front);
    this.parts = {
      table,
      back: this.jar.back,
      floor: this.jar.floor,
      snow,
      jelly: this.creatures.group,
      bubble: this.bubble.points,
      surface: this.jar.surface,
      front: this.jar.front,
    };

    this.composite = createComposite(pc.tableBackZ, pc.tableLeftX);
  }

  async load(baseUrl: string): Promise<void> {
    await this.room.load(this.renderer, baseUrl);
  }

  /** CSS の大きさとデバイスピクセル比から描画サイズを決める */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const ratio = Math.min(dpr, this.maxDpr);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(cssWidth, cssHeight, false);
    const w = Math.round(cssWidth * ratio);
    const h = Math.round(cssHeight * ratio);
    this.width = w;
    this.height = h;
    this.camera.aspect = cssWidth / cssHeight;
    this.camera.updateProjectionMatrix();
    for (const rt of [this.roomRT, this.bgRT, this.contentRT, this.glowRT]) rt.dispose();
    this.roomRT = createTarget(w, h);
    this.bgRT = createTarget(w, h);
    this.contentRT = createTarget(w, h);
    this.glowRT = createTarget(w / 2, h / 2);
    this.bloom.setSize(this.glowRT.width, this.glowRT.height);
    this.shared.uResolution.value.set(w, h);
    this.shared.uPixelRatio.value = ratio;
    this.shared.tRoom.value = this.roomRT.texture;
    this.shared.uViewProj.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const cover = coverTransform(cssWidth / cssHeight);
    this.jar.frontUniforms.uCoverScale.value.set(...cover.scale);
    this.jar.frontUniforms.uCoverOffset.value.set(...cover.offset);
    this.roomDirty = true;
  }

  /** 光の状態を設定する（時刻から計算したもの） */
  setLight(light: LightState): void {
    const prev = this.light;
    this.light = light;
    const changed =
      Math.abs(prev.day - light.day) + Math.abs(prev.dusk - light.dusk) + Math.abs(prev.night - light.night) + Math.abs(prev.dawnTint - light.dawnTint);
    if (changed > 1e-4) this.roomDirty = true;
    const s = this.shared;
    s.uKey.value.set(...light.key);
    s.uKeyDir.value.set(...light.keyDir);
    s.uLensLight.value = light.lensLight;
    s.uShadow.value = light.shadow;
    s.uRimWarm.value = light.rimWarm;
    // 起動したときは、デスクライトをいきなりその時刻の状態にする
    if (!this.lampReady) {
      this.lampReady = true;
      this.lampLevel = this.lampTarget();
    }
    this.applyLamp();
  }

  /** 夜のデスクライトを使うか（オフにすると瓶はほぼ闇になる） */
  setLampOn(on: boolean): void {
    this.lampOn = on;
  }

  get lampIsOn(): boolean {
    return this.lampOn;
  }

  private lampTarget(): number {
    return this.lampOn ? this.light.lamp : 0;
  }

  /** デスクライトの点き具合を uniform に反映する（光だまりの照り返しで、まわりもほんのり明るい） */
  private applyLamp(): void {
    const s = this.shared;
    const k = this.lampLevel * LAMP.intensity;
    s.uLampColor.value.set(LAMP.color[0] * k, LAMP.color[1] * k, LAMP.color[2] * k);
    s.uLampLevel.value = this.lampLevel;
    const a = this.light.ambient;
    const bounce = LAMP.bounce * this.lampLevel;
    s.uAmbient.value.set(a[0] + LAMP.color[0] * bounce, a[1] + LAMP.color[1] * bounce, a[2] + LAMP.color[2] * bounce);
  }

  /** 確認用：写真を1枚に固定する／別の写真を半透明で重ねる（null で時刻どおり） */
  setPhotoDebug(only: PhotoName | null, overlay: PhotoName | null): void {
    this.room.debugOnly = only;
    this.room.debugOverlay = overlay;
    this.roomDirty = true;
  }

  /** 確認用：背景の写真の代わりに縦縞を出す（屈折の写り方を見る） */
  setPatternDebug(on: boolean): void {
    this.room.debugPattern = on;
    this.roomDirty = true;
  }

  /** 表示中の瓶の個体に合わせる */
  setJar(jar: JarState): void {
    this.creatures.sync(jar);
  }

  /** 確認用：最初の泳ぐ個体の傘の中心の画面上の位置（CSS px）。いなければ null */
  jellyScreenPosition(cssWidth: number, cssHeight: number): [number, number] | null {
    const j = this.creatures.swimmers[0];
    if (!j) return null;
    const p = this.tmpV.copy(j.swimmer.pos).project(this.camera);
    return [((p.x + 1) / 2) * cssWidth, ((1 - p.y) / 2) * cssHeight];
  }

  /** ndc（-1〜1）の位置にいる泳ぐ個体（傘の見かけの大きさより少し広めに）。いなければ null */
  private swimmerAt(ndcX: number, ndcY: number): Jellyfish | null {
    const cam = this.camera;
    const aspect = cam.aspect;
    for (const j of this.creatures.swimmers) {
      const p = j.swimmer.pos;
      const c = this.tmpV.copy(p).project(cam);
      const e = this.tmpV2.set(p.x + j.radius, p.y, p.z).project(cam);
      const r = Math.abs(e.x - c.x) * aspect * 1.4;
      if (Math.hypot((ndcX - c.x) * aspect, ndcY - c.y) < r) return j;
    }
    return null;
  }

  /**
   * 画面をタップした（ndc は -1〜1）。海月の上なら 'jelly'（札は 3-2）、
   * 瓶の空いたところなら、ガラスをつついて近くの海月が反応する
   */
  tap(ndcX: number, ndcY: number): TapResult {
    const cam = this.camera;
    if (this.swimmerAt(ndcX, ndcY)) return 'jelly';

    // 瓶の外側の円筒に当たるか
    this.ray.origin.setFromMatrixPosition(cam.matrixWorld);
    this.ray.direction.set(ndcX, ndcY, 0.5).unproject(cam).sub(this.ray.origin).normalize();
    const o = this.ray.origin;
    const d = this.ray.direction;
    const R = JAR.radius;
    const a = d.x * d.x + d.z * d.z;
    const b = 2 * (o.x * d.x + o.z * d.z);
    const cc = o.x * o.x + o.z * o.z - R * R;
    const disc = b * b - 4 * a * cc;
    if (a < 1e-9 || disc < 0) return 'none';
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    const hit = this.tmpV.copy(o).addScaledVector(d, t);
    if (t <= 0 || hit.y < 0 || hit.y > JAR.height) return 'none';
    this.agitation = Math.min(1, this.agitation + 0.3);
    return this.creatures.poke(hit) ? 'poke' : 'none';
  }

  /** 描かずに動きだけを進める（確認用の早回しにも使う） */
  simulate(dt: number): void {
    const d = Math.min(Math.max(dt, 0), RENDER.maxFrameDt);
    this.time += d;
    // デスクライトは点く・消えるときに少しだけかけて変わる
    const target = this.lampTarget();
    if (this.lampLevel !== target) {
      const step = d / LAMP.fadeSeconds;
      this.lampLevel = target > this.lampLevel ? Math.min(target, this.lampLevel + step) : Math.max(target, this.lampLevel - step);
      this.applyLamp();
      this.roomDirty = true;
    }
    this.fade = Math.min(1, this.fade + d / RENDER.fadeInSeconds);
    this.shared.uTime.value = this.time;
    this.creatures.update(d, this.camera);
    this.bubble.update(d);
    // 拍動が水面を揺らす（水面に近いほど強い。小さな個体ほど弱い）
    let stir = 0;
    for (const j of this.creatures.swimmers) {
      const rate = Math.max(j.pulse.rate(), 0);
      const near = Math.exp(-(JAR.waterLevel - j.swimmer.pos.y) / 0.3);
      stir += rate * near * (j.radius / RENDER_ADULT_RADIUS);
    }
    this.agitation = Math.min(1, this.agitation * Math.exp(-d / WATER.agitationDecay) + WATER.agitationGain * stir * d);
    this.shared.uAgitation.value = this.agitation;
  }

  frame(dt: number): void {
    this.simulate(dt);
    const s = this.shared;
    // 光る種がいるときは、その光が周りを照らす（ミズクラゲは光らないので 0）
    const glowJelly = this.creatures.swimmers.find((j) => j.glowing);
    if (glowJelly) {
      glowJelly.glowPosition(s.uGlowPos.value);
      s.uGlowColor.value.copy(glowJelly.look.uGlow.value).multiplyScalar(0.6);
    } else {
      s.uGlowColor.value.set(0, 0, 0);
    }

    const r = this.renderer;
    // 部屋は光が変わったときだけ作り直す
    if (this.roomDirty) {
      this.room.render(r, this.roomRT, this.light, this.width / this.height);
      this.room.render(r, this.roomWideRT, this.light, null);
      this.roomDirty = false;
    }

    // 1. 背景：部屋に天板の影や光を重ねる
    this.copy.uniforms.tSrc.value = this.roomRT.texture;
    this.copy.render(r, this.bgRT);
    this.camera.layers.set(0);
    r.setRenderTarget(this.bgRT);
    r.render(this.bgScene, this.camera);

    // 2. 中身：透明な画像に描く（瓶底は背景の天板を映す）
    this.jar.floorBg.value = this.bgRT.texture;
    r.setRenderTarget(this.contentRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.contentScene, this.camera);

    // 3. 光る部分だけを描いてブルームにする（ミズクラゲは光らないので、光る種がいるときだけ）
    const glowing = this.creatures.glowing;
    if (glowing) {
      r.setRenderTarget(this.glowRT);
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      s.uGlowPass.value = 1;
      this.camera.layers.set(GLOW_LAYER);
      r.render(this.contentScene, this.camera);
      s.uGlowPass.value = 0;
      this.camera.layers.set(0);
      r.setClearColor(RENDER.clearColor, 1);
      this.bloom.render(r, this.glowRT);
    }
    const bloomStrength = glowing ? RENDER.bloomStrength : 0;

    // 4. 画面へ。背景を出してから、手前のガラスが瓶の部分を描く
    const cu = this.composite.uniforms;
    cu.tBg.value = this.bgRT.texture;
    cu.tContents.value = this.contentRT.texture;
    cu.tBloom.value = this.bloom.texture;
    cu.uBloomStrength.value = bloomStrength;
    cu.uFade.value = this.fade;
    this.tmpM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    cu.uViewProj.value.copy(this.tmpM);
    cu.uInvViewProj.value.copy(this.tmpM).invert();
    cu.uCamPos.value.copy(this.camera.getWorldPosition(this.tmpV));
    if (this.debugView) {
      const views: Record<string, Texture> = {
        bg: this.bgRT.texture,
        contents: this.contentRT.texture,
        glow: this.glowRT.texture,
        room: this.roomRT.texture,
      };
      cu.tBg.value = views[this.debugView] ?? this.bgRT.texture;
      cu.uBloomStrength.value = 0;
    }
    this.composite.render(r, null);
    if (this.debugView) return;

    const fu = this.jar.frontUniforms;
    fu.tBg.value = this.bgRT.texture;
    fu.tRoomWide.value = this.roomWideRT.texture;
    fu.tContents.value = this.contentRT.texture;
    fu.tBloom.value = this.bloom.texture;
    fu.uBloomStrength.value = bloomStrength;
    fu.uFade.value = this.fade;
    r.setRenderTarget(null);
    r.render(this.glassScene, this.camera);
  }
}
