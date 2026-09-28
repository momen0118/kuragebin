// 端末の動き（DeviceMotion）を受け取る。iOS は許可が要る（瓶をつついた最初のタップと、設定で「揺れを使う」を入れ直したときに訊く）。
// 許可がない・センサーのない端末では、何も起きずに普通に動く。
// デバッグパネルからは、センサーなしで揺れを試せる（一回揺らす）。
import { DEBUG } from '../config';
import { MotionFilter, quietSample, type MotionSample, type RawMotion, type V3 } from './motionFilter';

export type MotionPermission = 'unknown' | 'granted' | 'denied';

type PermissionRequester = { requestPermission?: () => Promise<'granted' | 'denied' | 'default'> };

function requester(): PermissionRequester | null {
  const E = (globalThis as { DeviceMotionEvent?: PermissionRequester }).DeviceMotionEvent;
  return E ?? null;
}

const v3 = (o: { x: number | null; y: number | null; z: number | null } | null | undefined): V3 | null =>
  o && o.x !== null && o.y !== null && o.z !== null ? [o.x, o.y, o.z] : null;

export class DeviceMotionSource {
  /** センサーの値から、瓶の座標の動きを作る。iOS は加速度の符号が逆の端末として始める（違えば直す） */
  private readonly filter = new MotionFilter(requester()?.requestPermission ? -1 : 1);
  private listening = false;
  private lastEvent = 0;
  private permission: MotionPermission = requester()?.requestPermission ? 'unknown' : 'granted';
  private readonly onEvent = (e: DeviceMotionEvent): void => this.handle(e);

  /** センサーがあるか（ブラウザが対応しているか。実際に値が来るかは別） */
  get supported(): boolean {
    return requester() !== null;
  }

  /** 使う前に許可を訊く必要がある（iOS で、この起動中にまだ許可されていない） */
  get needsPermission(): boolean {
    return this.permission !== 'granted';
  }

  get state(): MotionPermission {
    return this.permission;
  }

  /**
   * 許可を訊く。利用者の操作（タップ）の中から呼ぶこと。
   * 許可されたら 'granted'、断られたら 'denied'。訊けなかったとき（操作の外から呼んだなど）は 'unknown' のまま
   */
  async request(): Promise<MotionPermission> {
    const r = requester();
    if (!r?.requestPermission) {
      this.permission = r ? 'granted' : 'denied';
      return this.permission;
    }
    try {
      const answer = await r.requestPermission();
      this.permission = answer === 'granted' ? 'granted' : 'denied';
    } catch {
      // 利用者の操作の外から呼んだときなど。次のタップでまた訊ける
    }
    return this.permission;
  }

  /** 受け取るかどうか（設定の「揺れを使う」と許可）。止めたら値を捨てる */
  setListening(on: boolean): void {
    const want = on && this.permission === 'granted' && this.supported;
    if (want === this.listening) return;
    this.listening = want;
    if (want) window.addEventListener('devicemotion', this.onEvent);
    else {
      window.removeEventListener('devicemotion', this.onEvent);
      this.filter.reset();
    }
  }

  get isListening(): boolean {
    return this.listening;
  }

  private handle(e: DeviceMotionEvent): void {
    const now = performance.now();
    const dt = e.interval ? (e.interval > 1 ? e.interval / 1000 : e.interval) : this.lastEvent ? (now - this.lastEvent) / 1000 : 1 / 60;
    this.lastEvent = now;
    const r = e.rotationRate;
    const raw: RawMotion = {
      withGravity: v3(e.accelerationIncludingGravity),
      linear: v3(e.acceleration),
      rotation: r && r.alpha !== null && r.beta !== null && r.gamma !== null ? [r.alpha, r.beta, r.gamma] : null,
    };
    const angle = screen.orientation?.angle ?? 0;
    this.filter.push(raw, dt, angle);
  }

  /** 今の動き（瓶の座標）。受け取っていない・しばらく値が来ていなければ null */
  sample(staleSeconds: number): MotionSample | null {
    if (!this.listening || performance.now() - this.lastEvent > staleSeconds * 1000) return null;
    return this.filter.sample();
  }

  /** 確認用：加速度の符号（1 なら仕様どおり） */
  get accelSign(): number {
    return this.filter.accelSign;
  }
}

type ShakeKind = keyof typeof DEBUG.shakes;

/**
 * 確認用の揺れ。一回揺らす（決まった向きに何往復か振る。弱は閾値を越えない強さ）。
 * センサーの値に加速度として足す（振ったかどうかの判定は、センサーと同じく ShakeDetector がする）
 */
export class DebugMotion {
  private shake: { kind: ShakeKind; t: number } | null = null;

  /** 一回揺らす */
  start(kind: ShakeKind): void {
    this.shake = { kind, t: 0 };
  }

  get active(): boolean {
    return this.shake !== null;
  }

  update(dt: number): void {
    if (!this.shake) return;
    this.shake.t += dt;
    if (this.shake.t > DEBUG.shakes[this.shake.kind].seconds) this.shake = null;
  }

  /** センサーの値（なければ null）に、確認用の揺れを重ねる。どちらもなければ null */
  apply(base: MotionSample | null): MotionSample | null {
    if (!this.shake) return base;
    const out = base ? { accel: [...base.accel] as V3, spin: [...base.spin] as V3 } : quietSample();
    const s = DEBUG.shakes[this.shake.kind];
    const t = this.shake.t;
    // 振りはじめと終わりは弱く。何往復か振る
    const env = Math.sin((Math.PI * t) / s.seconds) ** 0.5;
    const a = s.accel * env * Math.sin(2 * Math.PI * s.freq * t);
    const l = Math.hypot(...s.dir) || 1;
    for (let i = 0; i < 3; i++) out.accel[i]! += (s.dir[i]! / l) * a;
    return out;
  }
}
