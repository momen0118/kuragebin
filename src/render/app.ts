// 描画のまとめ役。背景・瓶・水・海月を順に重ね、ブルームをかけて画面に出す。
import {
  Matrix4,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Object3D,
  type Texture,
} from 'three';
import { JELLY_LOOK, RENDER, RIM_WARM } from '../config';
import { createRng } from '../sim/rng';
import { Bloom } from './bloom';
import { solvePhotoCamera, type PhotoCamera } from './camera';
import { createComposite } from './composite';
import { FullscreenPass } from './fullscreen';
import { createJar, type Jar } from './jar';
import { Jellyfish } from './jelly/jellyfish';
import { lightAt, type LightState } from './lighting';
import { Bubble, createSnow } from './particles';
import { Room } from './room';
import { createTable } from './table';
import { chooseTargetType, createTarget } from './targets';
import { createSharedUniforms, type SharedUniforms } from './uniforms';

/** 発光パスで描くもの */
const GLOW_LAYER = 1;

const COPY = /* glsl */ `
uniform sampler2D tSrc;
in vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, 1.0); }
`;


export class App {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly shared: SharedUniforms = createSharedUniforms();
  private readonly photoCam: PhotoCamera = solvePhotoCamera();
  private readonly scene = new Scene();
  private readonly glassScene = new Scene();
  private readonly room = new Room();
  private readonly jar: Jar;
  private readonly jelly: Jellyfish;
  private readonly bubble: Bubble;
  private readonly bloom = new Bloom(RENDER.bloomLevels);
  private readonly composite;
  private readonly copy = new FullscreenPass(COPY, { tSrc: { value: null as Texture | null } });
  private roomRT: WebGLRenderTarget;
  private sceneRT: WebGLRenderTarget;
  private glowRT: WebGLRenderTarget;
  private width = 1;
  private height = 1;
  private roomDirty = true;
  private light: LightState = lightAt(12);
  private time = 0;
  private fade = 0;
  private readonly tmpV = new Vector3();
  private readonly tmpM = new Matrix4();
  /** 確認用：中間の画像をそのまま出す（'scene' | 'glow' | 'room'） */
  debugView: string | null = null;
  /** 確認用：部品ごとに表示を切り替える */
  readonly parts: Record<string, Object3D>;

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
    this.sceneRT = createTarget(1, 1);
    this.glowRT = createTarget(1, 1);

    const pc = this.photoCam;
    this.camera = new PerspectiveCamera(pc.vFovDeg, 1, 0.05, 20);
    this.camera.position.set(...pc.position);
    this.camera.rotation.set(-pc.pitch, 0, 0);
    this.camera.updateMatrixWorld();

    const rng = createRng(RENDER.seed);
    this.jar = createJar(this.shared, RIM_WARM.color);
    this.jelly = new Jellyfish(this.shared, rng);
    this.jelly.group.traverse((o) => o.layers.enable(GLOW_LAYER));
    this.bubble = new Bubble(this.shared, rng);

    const table = createTable(this.shared, pc);
    const snow = createSnow(this.shared, rng);
    this.scene.add(table, this.jar.back, this.jar.floor, snow, this.jelly.group, this.bubble.points, this.jar.surface);
    this.glassScene.add(this.jar.front);
    this.parts = {
      table,
      back: this.jar.back,
      floor: this.jar.floor,
      snow,
      jelly: this.jelly.group,
      tentacles: this.jelly.tentacles.mesh,
      outer0: this.jelly.bell.meshes[0]!,
      inner0: this.jelly.bell.meshes[1]!,
      gonads: this.jelly.bell.meshes[2]!,
      inner1: this.jelly.bell.meshes[3]!,
      outer1: this.jelly.bell.meshes[4]!,
      arms: this.jelly.arms.mesh,
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
    const ratio = Math.min(dpr, RENDER.maxDpr);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(cssWidth, cssHeight, false);
    const w = Math.round(cssWidth * ratio);
    const h = Math.round(cssHeight * ratio);
    this.width = w;
    this.height = h;
    this.camera.aspect = cssWidth / cssHeight;
    this.camera.updateProjectionMatrix();
    for (const rt of [this.roomRT, this.sceneRT, this.glowRT]) rt.dispose();
    this.roomRT = createTarget(w, h);
    this.sceneRT = createTarget(w, h);
    this.glowRT = createTarget(w / 2, h / 2);
    this.bloom.setSize(this.glowRT.width, this.glowRT.height);
    this.shared.uResolution.value.set(w, h);
    this.shared.uPixelRatio.value = ratio;
    this.shared.tRoom.value = this.roomRT.texture;
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
    s.uAmbient.value.set(...light.ambient);
    s.uCaustics.value = light.caustics;
    s.uShadow.value = light.shadow;
    s.uRimWarm.value = light.rimWarm;
    this.jelly.setGlow(light.glow);
  }

  /** 確認用：海月の傘の中心の画面上の位置（CSS px） */
  jellyScreenPosition(cssWidth: number, cssHeight: number): [number, number] {
    const p = this.tmpV.copy(this.jelly.swimmer.pos).project(this.camera);
    return [((p.x + 1) / 2) * cssWidth, ((1 - p.y) / 2) * cssHeight];
  }

  /** 描かずに動きだけを進める（確認用の早回し） */
  simulate(dt: number): void {
    const d = Math.min(Math.max(dt, 0), RENDER.maxFrameDt);
    this.time += d;
    this.fade = Math.min(1, this.fade + d / RENDER.fadeInSeconds);
    this.shared.uTime.value = this.time;
    this.jelly.update(d);
    this.bubble.update(d);
  }

  frame(dt: number): void {
    this.simulate(dt);
    const s = this.shared;
    this.jelly.glowPosition(s.uGlowPos.value);
    s.uGlowColor.value.copy(this.jelly.look.uGlow.value).multiplyScalar(JELLY_LOOK.lightStrength);

    const r = this.renderer;
    // 部屋は光が変わったときだけ作り直す
    if (this.roomDirty) {
      this.room.render(r, this.roomRT, this.light, this.width / this.height);
      this.roomDirty = false;
    }

    // 1. 部屋の上に、天板・瓶の奥・水の中を重ねる
    this.copy.uniforms.tSrc.value = this.roomRT.texture;
    this.copy.render(r, this.sceneRT);
    this.camera.layers.set(0);
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, this.camera);

    // 2. 光る部分だけを描いてブルームにする
    r.setRenderTarget(this.glowRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    s.uGlowPass.value = 1;
    this.camera.layers.set(GLOW_LAYER);
    r.render(this.scene, this.camera);
    s.uGlowPass.value = 0;
    this.camera.layers.set(0);
    r.setClearColor(RENDER.clearColor, 1);
    this.bloom.render(r, this.glowRT);

    // 3. 画面へ。合成してから手前のガラスを重ねる
    const cu = this.composite.uniforms;
    cu.tScene.value = this.sceneRT.texture;
    cu.tRoom.value = this.roomRT.texture;
    cu.tBloom.value = this.bloom.texture;
    cu.uBloomStrength.value = RENDER.bloomStrength;
    cu.uFade.value = this.fade;
    this.tmpM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    cu.uViewProj.value.copy(this.tmpM);
    cu.uInvViewProj.value.copy(this.tmpM).invert();
    cu.uCamPos.value.copy(this.camera.getWorldPosition(this.tmpV));
    if (this.debugView === 'glow') cu.tScene.value = this.glowRT.texture;
    if (this.debugView === 'room') cu.tScene.value = this.roomRT.texture;
    if (this.debugView) cu.uBloomStrength.value = 0;
    this.composite.render(r, null);
    if (this.debugView) return;

    const fu = this.jar.frontUniforms;
    fu.tScene.value = this.sceneRT.texture;
    fu.tBloom.value = this.bloom.texture;
    fu.uBloomStrength.value = RENDER.bloomStrength;
    fu.uFade.value = this.fade;
    r.setRenderTarget(null);
    r.render(this.glassScene, this.camera);
  }
}
