// 描画のまとめ役。
// 1. 背景：部屋の写真に天板の影や光を重ねる
// 2. 中身：瓶の中（奥のガラス・瓶底・マリンスノー・海月・泡・水面）を透明な画像に描く
// 3. 発光：海月の光る部分だけを描いてブルームにする
// 4. 画面へ：背景を出し、最後に手前のガラスが背景と中身をレンズとして曲げて重ねる
//
// 3つの瓶は天板の上に横に並んでいる。瓶 i は x = (i - view) × spacing に立ち、見えている瓶（ふだんは1つ、
// すれ違う間は2つ）だけを描く。瓶ごとに、カメラをその瓶の位置だけ横へずらして、瓶を原点に置いたまま描く
// （デスクライトも瓶ごとにあり、瓶と一緒に動く）。部屋の写真は視差でほんの少しだけずらす
import {
  Group,
  Matrix4,
  PerspectiveCamera,
  Ray,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Object3D,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { BELL, CUP, JAR, LAMP, PHOTO, RENDER, RIM_WARM, SIM, SWIPE, WATER, type PhotoName } from '../config';
import { createRng } from '../sim/rng';
import type { JarState } from '../sim/state';
import { Bloom } from './bloom';
import { coverTransform, solvePhotoCamera, type PhotoCamera } from './camera';
import { createComposite } from './composite';
import { FullscreenPass } from './fullscreen';
import { Creatures } from './creatures';
import { Cup } from './cup';
import { createJar, type Jar } from './jar';
import { apparentNdc } from './lensMap';
import { lightAt, type LightState } from './lighting';
import { Bubble, createSnow, type Snow } from './particles';
import { Room } from './room';
import { Scoop } from './scoop';
import { createTable, type TableJars } from './table';
import { chooseTargetType, createTarget } from './targets';
import { createSharedUniforms, type SharedUniforms } from './uniforms';

/** 発光パスで描くもの */
const GLOW_LAYER = 1;
/** 水面を揺らす強さの基準（成体の傘の半径） */
const RENDER_ADULT_RADIUS = BELL.radius;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

const COPY = /* glsl */ `
uniform sampler2D tSrc;
in vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, 1.0); }
`;

/** 札の線を付ける所（CSS px）。App.noteAnchor */
export interface NoteAnchor {
  x: number;
  y: number;
  r: number;
  swimmer: boolean;
  left: number;
  right: number;
  top: number;
}

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
  /** 瓶ごとの個体（1番の瓶から） */
  readonly jars: Creatures[];
  private readonly bubbles: Bubble[];
  private readonly snow: Snow;
  private readonly tableJars: TableJars;
  /** 瓶を1つ描くときのカメラ（その瓶の位置だけ横へずらす） */
  private readonly jarCam: PerspectiveCamera;
  /** 瓶の並びの上の位置（0 が1番の瓶。スワイプの途中は小数） */
  private view = 0;
  /** 隣の瓶との間（ワールド）と、その画面上の長さ（CSS px） */
  private spacing = 0.85;
  private spacingPx = 360;
  /** 瓶1つ分動いたときの写真のずれ（写真の uv）：奥の壁、手前の天板 */
  private parallaxStep: [number, number] = [0, 0];
  /** 瓶ごとの水面の揺れ（0〜1）。拍動やつつきで立ち、ゆっくり収まる */
  private readonly agitations: number[];
  private wideDirty = true;
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
  /** 夜のデスクライト：使うかどうか（利用者の切り替え、初期はオン）と、今の点き具合（0〜1） */
  private lampOn = true;
  private lampLevel = 0;
  private lampReady = false;
  private readonly tmpV = new Vector3();
  private readonly tmpV2 = new Vector3();
  private readonly tmpM = new Matrix4();
  private readonly tmpN = new Vector2();
  private readonly ray = new Ray();
  /** カップで運んでいる個体（どの瓶にも描かない） */
  private readonly carried = new Set<number>();
  /** 海月を水ごと運ぶカップと、その流れ。カップは瓶の中身とは別に描く */
  private readonly cup: Cup;
  private readonly cupScene = new Scene();
  private readonly scoop: Scoop;
  /** 瓶ごとの水面の波紋（x, z, 始まった時刻, 強さ） */
  private readonly ripples: Vector4[][];
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

    this.jarCam = this.camera.clone();

    const rng = createRng(RENDER.seed);
    this.jar = createJar(this.shared, RIM_WARM.color);
    this.jars = Array.from({ length: SIM.jarCount }, () => new Creatures(this.shared, GLOW_LAYER, this.carried));
    this.ripples = this.jars.map(() => [0, 1, 2, 3].map(() => new Vector4()));
    this.cup = new Cup(this.shared);
    this.cupScene.add(this.cup.group);
    const app = this;
    this.scoop = new Scoop(
      {
        get spacing() {
          return app.spacing;
        },
        get view() {
          return app.view;
        },
        // 画面の横幅の半分（瓶の奥行きで）からカップの半径と余白を引いた分
        get hoverRange() {
          return app.spacing - JAR.radius - SWIPE.gap - CUP.radiusTop - CUP.spout - 0.03;
        },
        ripple: (jar, x, z, strength) => this.addRipple(jar, x, z, strength),
        adopt: (jar, id, jelly) => this.jars[jar]?.adopt(id, jelly),
        cameraPosition: (jar, out) => out.setFromMatrixPosition(this.placeJarCamera(jar).matrixWorld),
      },
      this.cup,
    );
    this.bubbles = this.jars.map(() => new Bubble(this.shared, rng));
    this.agitations = this.jars.map(() => 0);

    const table = createTable(this.shared, pc);
    this.tableJars = table.jars;
    this.snow = createSnow(this.shared, rng);
    this.bgScene.add(table.mesh);
    this.contentScene.add(this.jar.back, this.jar.floor, this.snow.points, ...this.jars.map((c) => c.group), ...this.bubbles.map((b) => b.points), this.jar.surface);
    this.glassScene.add(this.jar.front);
    const jellies = new Group();
    this.parts = {
      table: table.mesh,
      back: this.jar.back,
      floor: this.jar.floor,
      snow: this.snow.points,
      jelly: jellies,
      bubble: this.bubbles[0]!.points,
      surface: this.jar.surface,
      front: this.jar.front,
    };
    // 確認用の ?hide=jelly は、すべての瓶の個体を隠す
    Object.defineProperty(jellies, 'visible', {
      set: (v: boolean) => {
        for (const c of this.jars) c.hidden = !v;
      },
      get: () => !this.jars[0]!.hidden,
    });

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
    this.jarCam.aspect = this.camera.aspect;
    this.jarCam.updateProjectionMatrix();
    this.shared.uViewProj.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const cover = coverTransform(cssWidth / cssHeight);
    this.jar.frontUniforms.uCoverScale.value.set(...cover.scale);
    this.jar.frontUniforms.uCoverOffset.value.set(...cover.offset);
    this.layoutJars(cssWidth, cssHeight);
    this.roomDirty = true;
  }

  /**
   * 瓶の並べ方：止まっているときに隣の瓶が画面の外にちょうど隠れる間隔と、瓶1つ分動いたときの写真のずれ。
   * 写真のずれは、1番の瓶で写真の元の位置、3番の瓶まで写真の端が見えない範囲に収める
   */
  private layoutJars(cssWidth: number, cssHeight: number): void {
    const cam = this.camera;
    // 瓶の高さの真ん中あたりで、画面の右端が瓶の奥行きのどこに当たるか
    const mid = this.tmpV.set(0, JAR.height * 0.45, 0).project(cam);
    const edge = this.tmpV2.set(1, mid.y, 0.5).unproject(cam);
    const origin = this.tmpV.setFromMatrixPosition(cam.matrixWorld);
    const dir = edge.sub(origin).normalize();
    const t = -origin.z / dir.z;
    const halfWidth = Math.abs(origin.x + dir.x * t);
    this.spacing = halfWidth + JAR.radius + SWIPE.gap;
    this.spacingPx = (this.spacing / halfWidth) * (cssWidth / 2);
    // 写真のずれ（写真px）。瓶1つ分は瓶の奥行きで spacing、写真では瓶の高さ（jarHeightPx）が 1
    const stepPx = this.spacing * (PHOTO.jarHeightPx / JAR.height);
    const visiblePx = PHOTO.height * (cssWidth / cssHeight);
    const margin = Math.max(0, (PHOTO.width - visiblePx) / 2);
    let wall = SWIPE.parallaxWall * stepPx;
    let table = SWIPE.parallaxTable * stepPx;
    // 端の瓶で引っ張った分（SWIPE.edgeMax）も、写真の端が見えない範囲に入れる
    const maxStep = margin / Math.max(1, this.jars.length - 1 + SWIPE.edgeMax);
    if (table > maxStep) {
      const k = maxStep / table;
      wall *= k;
      table *= k;
    }
    this.parallaxStep = [wall / PHOTO.width, table / PHOTO.width];
  }

  /** 瓶の並びの上の位置（0 が1番の瓶、スワイプの途中は小数） */
  get viewPosition(): number {
    return this.view;
  }

  /** 瓶の並びの上の位置を決める（スワイプ） */
  setView(v: number): void {
    if (v === this.view) return;
    this.view = v;
    this.roomDirty = true;
  }

  /** 隣の瓶との間の、画面上の長さ（CSS px）。指の動きをこれで割ると瓶の数になる */
  get jarStepPx(): number {
    return this.spacingPx;
  }

  /** 今いちばん近い瓶 */
  get jarIndex(): number {
    return Math.min(Math.max(Math.round(this.view), 0), this.jars.length - 1);
  }

  /** 表示中の瓶の個体 */
  get creatures(): Creatures {
    return this.jars[this.jarIndex]!;
  }

  /** 瓶 i の横の位置（ワールド x） */
  private jarX(i: number): number {
    return (i - this.view) * this.spacing;
  }

  /** 見えている瓶（ふだんは1つ、すれ違う間は2つ） */
  private visibleJars(): number[] {
    const n = this.jars.length;
    const v = this.view;
    const near = Math.round(v);
    if (Math.abs(v - near) < 1e-4) return [Math.min(Math.max(near, 0), n - 1)];
    const lo = Math.floor(v);
    return [lo, lo + 1].filter((i) => i >= 0 && i < n);
  }

  /** 瓶 i を描く・動かすためにカメラをずらす（瓶は原点のまま） */
  private placeJarCamera(i: number): PerspectiveCamera {
    const pc = this.photoCam;
    this.jarCam.position.set(pc.position[0] - this.jarX(i), pc.position[1], pc.position[2]);
    this.jarCam.updateMatrixWorld();
    return this.jarCam;
  }

  /** 瓶 i を描くときの共有の値：カメラ、水面の揺れ、粒の並び、その瓶の個体と泡だけを出す */
  private useJar(i: number): PerspectiveCamera {
    const cam = this.placeJarCamera(i);
    this.shared.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.shared.uAgitation.value = this.agitations[i]!;
    this.shared.uRipples.value = this.ripples[i]!;
    this.snow.shift.value = i;
    this.jars.forEach((c, k) => (c.group.visible = k === i && !c.hidden));
    this.bubbles.forEach((b, k) => (b.points.visible = k === i && b.isActive));
    return cam;
  }

  /** 光の状態を設定する（時刻から計算したもの） */
  setLight(light: LightState): void {
    const prev = this.light;
    this.light = light;
    const changed =
      Math.abs(prev.day - light.day) + Math.abs(prev.dusk - light.dusk) + Math.abs(prev.night - light.night) + Math.abs(prev.dawnTint - light.dawnTint);
    if (changed > 1e-4) this.roomDirty = this.wideDirty = true;
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
    this.roomDirty = this.wideDirty = true;
  }

  /** 確認用：背景の写真の代わりに縦縞を出す（屈折の写り方を見る） */
  setPatternDebug(on: boolean): void {
    this.room.debugPattern = on;
    this.roomDirty = this.wideDirty = true;
  }

  /** 瓶ごとの個体を状態に合わせる */
  setJars(jars: readonly JarState[]): void {
    jars.forEach((jar, i) => this.jars[i]?.sync(jar));
  }

  /** 確認用：最初の泳ぐ個体の傘の中心の画面上の位置（CSS px）。いなければ null */
  jellyScreenPosition(cssWidth: number, cssHeight: number): [number, number] | null {
    const j = this.creatures.swimmers[0];
    if (!j) return null;
    const p = this.tmpV.copy(j.swimmer.pos).project(this.placeJarCamera(this.jarIndex));
    return [((p.x + 1) / 2) * cssWidth, ((1 - p.y) / 2) * cssHeight];
  }

  /** 瓶が止まっているか（スワイプの途中でない） */
  get atRest(): boolean {
    return Math.abs(this.view - Math.round(this.view)) < 1e-3;
  }

  /**
   * 表示中の瓶で、画面上の点（ndc、-1〜1）にいる個体の番号。瓶が止まっているときだけ。
   * minNdc は指で押せる大きさ（画面の高さの半分を 1 とした半径）。swimmersOnly なら泳ぐ個体だけ
   */
  pickAt(ndcX: number, ndcY: number, minNdc: number, swimmersOnly = false): number | null {
    if (!this.atRest) return null;
    const i = this.jarIndex;
    return this.jars[i]!.pick(ndcX, ndcY, this.placeJarCamera(i), minNdc, swimmersOnly);
  }

  /**
   * 表示中の瓶の個体に札の線を付ける所（CSS px）。水とガラスのレンズ越しに見えている位置で、
   * x, y は傘の中心（ポリプは触手の冠）、r は見かけの半径。left・right・top は瓶の左右の縁と上端。いなければ null
   */
  noteAnchor(id: number, cssWidth: number, cssHeight: number): NoteAnchor | null {
    const i = this.jarIndex;
    const body = this.jars[i]!.bodyOf(id, this.tmpV);
    if (!body) return null;
    const cam = this.placeJarCamera(i);
    const toCss = (n: Vector2): [number, number] => [((n.x + 1) / 2) * cssWidth, ((1 - n.y) / 2) * cssHeight];
    const [x, y] = toCss(apparentNdc(cam, body.center, this.tmpN));
    // 見かけの半径：カメラの横向きに半径だけずらした点がどこに見えるか
    const side = this.tmpV2.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(body.radius).add(body.center);
    const [sx, sy] = toCss(apparentNdc(cam, side, this.tmpN));
    const r = Math.hypot(sx - x, sy - y);
    // 瓶の輪郭：胴の左右の縁（真ん中の高さ）と、口の縁の上端（奥の縁がいちばん上に見える）
    const [left] = toCss(this.tmpN.set(this.tmpV.set(-JAR.radius, JAR.height * 0.5, 0).project(cam).x, 0));
    const [right] = toCss(this.tmpN.set(this.tmpV.set(JAR.radius, JAR.height * 0.5, 0).project(cam).x, 0));
    const top = toCss(this.tmpN.set(0, this.tmpV.set(0, JAR.height, -JAR.neckRadius).project(cam).y))[1];
    return { x, y, r, swimmer: body.swimmer, left, right, top };
  }

  /**
   * 画面をタップした（ndc は -1〜1）。瓶の空いたところなら、ガラスをつついて近くの海月が反応する。
   * 反応した個体がいれば true
   */
  poke(ndcX: number, ndcY: number): boolean {
    if (!this.atRest) return false;
    const i = this.jarIndex;
    const cam = this.placeJarCamera(i);

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
    if (a < 1e-9 || disc < 0) return false;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    const hit = this.tmpV.copy(o).addScaledVector(d, t);
    if (t <= 0 || hit.y < 0 || hit.y > JAR.height) return false;
    this.agitations[i] = Math.min(1, this.agitations[i]! + 0.3);
    return this.jars[i]!.poke(hit);
  }

  /** 瓶 i のカメラから画面上の点（ndc）へ向かう線が、奥行き z の面と交わる所（瓶の中心が原点） */
  private pointAtDepth(i: number, ndcX: number, ndcY: number, z: number, out: Vector3): Vector3 {
    const cam = this.placeJarCamera(i);
    const o = this.ray.origin.setFromMatrixPosition(cam.matrixWorld);
    const d = this.ray.direction.set(ndcX, ndcY, 0.5).unproject(cam).sub(o).normalize();
    const t = Math.abs(d.z) > 1e-6 ? (z - o.z) / d.z : 0;
    return out.copy(o).addScaledVector(d, Math.max(t, 0));
  }

  /** 瓶 jar の水面に波紋を立てる（いちばん古いものと入れ替える） */
  private addRipple(jar: number, x: number, z: number, strength: number): void {
    const list = this.ripples[jar];
    if (!list) return;
    let slot = list[0]!;
    for (const r of list) if (r.w <= 0 || r.z < slot.z) slot = r;
    slot.set(x, z, this.time, strength);
  }

  /** カップを使っているところか（上がる〜去るまで）。その間は新しく運べない */
  get scoopBusy(): boolean {
    return this.scoop.busy;
  }

  /** カップの中の個体（注ぎ終えたら null） */
  get scoopId(): number | null {
    return this.scoop.carriedId;
  }

  /** いま指を離したらカップが注ぐ瓶（隣へ移る途中なら行き先）。カップを使っていなければ表示中の瓶 */
  get scoopDestination(): number {
    return this.scoop.busy ? this.scoop.destination : this.jarIndex;
  }

  /** 長押し：表示中の瓶の泳ぐ個体 id を、水ごとカップに入れて瓶の口から上げる。はじめられたら true */
  scoopStart(id: number): boolean {
    if (this.scoop.busy || !this.atRest) return false;
    const i = this.jarIndex;
    const jelly = this.jars[i]!.lift(id);
    if (!jelly) return false;
    this.scoop.begin(i, id, jelly);
    return true;
  }

  /** 指の位置（ndc）。運んでいる間、カップが少し遅れてついてくる（横だけ） */
  scoopFollow(ndcX: number, ndcY: number): void {
    if (!this.scoop.busy) return;
    const f = this.scoop.frameJar;
    this.scoop.follow(this.pointAtDepth(f, ndcX, ndcY, 0, this.tmpV).x + this.jarX(f));
  }

  /** カップを隣の瓶 to の上へ移す（注がない）。onStart は移りはじめたとき（画面を隣の瓶へ動かす） */
  scoopCross(to: number, onStart: () => void): void {
    this.scoop.cross(to, onStart);
  }

  /** 指を離した：カップが今いる瓶（移る途中なら行き先）の口の上で注ぐ */
  scoopRelease(): void {
    this.scoop.release();
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
      this.roomDirty = this.wideDirty = true;
    }
    this.fade = Math.min(1, this.fade + d / RENDER.fadeInSeconds);
    this.shared.uTime.value = this.time;
    // 動かすのは見えている瓶だけ。ほかの瓶の個体は止めておく（状態はシミュレーションで進む）
    for (const i of this.visibleJars()) {
      const creatures = this.jars[i]!;
      creatures.update(d, this.placeJarCamera(i));
      this.bubbles[i]!.update(d);
      // 拍動が水面を揺らす（水面に近いほど強い。小さな個体ほど弱い）
      let stir = 0;
      for (const j of creatures.swimmers) {
        const rate = Math.max(j.pulse.rate(), 0);
        const near = Math.exp(-(JAR.waterLevel - j.swimmer.pos.y) / 0.3);
        stir += rate * near * (j.radius / RENDER_ADULT_RADIUS);
      }
      this.agitations[i] = Math.min(1, this.agitations[i]! * Math.exp(-d / WATER.agitationDecay) + WATER.agitationGain * stir * d);
    }
    this.scoop.update(d);
  }

  /** カップを瓶 jar のカメラで描く。mode 1 は瓶の中の部分だけ、2 は外の部分だけ（shaders/clip.ts） */
  private renderCup(jar: number, mode: number): void {
    const cam = this.useJar(jar);
    this.cup.prepare(cam);
    this.shared.uClipMode.value = mode;
    this.renderer.render(this.cupScene, cam);
    this.shared.uClipMode.value = 0;
  }

  frame(dt: number): void {
    this.simulate(dt);
    const s = this.shared;
    const vis = this.visibleJars();
    const xs = vis.map((i) => this.jarX(i));
    // 光る種がいるときは、その光が周りを照らす（ミズクラゲは光らないので 0）。表示中の瓶の光だけ
    const glowJelly = this.creatures.swimmers.find((j) => j.glowing);
    if (glowJelly) {
      glowJelly.glowPosition(s.uGlowPos.value);
      s.uGlowColor.value.copy(glowJelly.look.uGlow.value).multiplyScalar(0.6);
    } else {
      s.uGlowColor.value.set(0, 0, 0);
    }

    const r = this.renderer;
    // 部屋は光が変わったとき（と、瓶を切り替えている間）だけ作り直す
    if (this.roomDirty) {
      const [wall, table] = this.parallaxStep;
      this.room.render(r, this.roomRT, this.light, this.width / this.height, { shift: [wall * this.view, table * this.view], jars: xs });
      this.roomDirty = false;
    }
    if (this.wideDirty) {
      this.room.render(r, this.roomWideRT, this.light, null);
      this.wideDirty = false;
    }

    // 1. 背景：部屋に天板の影や光を重ねる（見えている瓶ごとに）
    this.copy.uniforms.tSrc.value = this.roomRT.texture;
    this.copy.render(r, this.bgRT);
    const tj = this.tableJars;
    tj.uJarCount.value = vis.length;
    vis.forEach((i, k) => {
      tj.uJarX.value[k] = xs[k]!;
      tj.uJarAgitation.value[k] = this.agitations[i]!;
    });
    this.camera.layers.set(0);
    r.setRenderTarget(this.bgRT);
    r.render(this.bgScene, this.camera);
    // カップ（と中の海月・注ぐ水）の、瓶の口より上にある部分は背景に重ねる
    if (this.scoop.busy) this.renderCup(this.scoop.frameJar, 2);

    // 2. 中身：透明な画像に描く（瓶底は背景の天板を映す）。見えている瓶ごとに、その瓶の位置へずらしたカメラで
    this.jar.floorBg.value = this.bgRT.texture;
    r.setRenderTarget(this.contentRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    for (const i of vis) {
      r.render(this.contentScene, this.useJar(i));
      // カップの、瓶の口より下にある部分は瓶の中身として（手前のガラス越しに曲がって見える）
      if (this.scoop.busy && i === this.scoop.frameJar) this.renderCup(i, 1);
    }

    // 3. 光る部分だけを描いてブルームにする（ミズクラゲは光らないので、光る種がいるときだけ）
    const glowing = vis.some((i) => this.jars[i]!.glowing);
    if (glowing) {
      r.setRenderTarget(this.glowRT);
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      s.uGlowPass.value = 1;
      for (const i of vis) {
        const cam = this.useJar(i);
        cam.layers.set(GLOW_LAYER);
        r.render(this.contentScene, cam);
        cam.layers.set(0);
      }
      s.uGlowPass.value = 0;
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
    cu.uJarCount.value = vis.length;
    xs.forEach((x, k) => (cu.uJarX.value[k] = x));
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
    fu.uParallax.value = this.parallaxStep[0] * this.view;
    r.setRenderTarget(null);
    for (const i of vis) {
      const cam = this.useJar(i);
      const [near, far] = SWIPE.windowSideFade;
      fu.uWindowSide.value = 1 - smoothstep(near, far, Math.abs(i - this.view));
      r.render(this.glassScene, cam);
    }
  }
}
