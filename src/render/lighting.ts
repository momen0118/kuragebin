// 現地時刻（時）から光の状態を決める。three.js に依存しない純粋な関数。
import { LIGHT_KEYS, RIM_WARM, type LightKey, type Vec3 } from '../config';

export interface LightState {
  /** 背景写真の重み（合計1） */
  day: number;
  dusk: number;
  night: number;
  /** 明け方の青み（0〜1） */
  dawnTint: number;
  /** 窓からの光（色×強さ）と、光の来る向き（正規化済み） */
  key: Vec3;
  keyDir: Vec3;
  ambient: Vec3;
  /** 海月の発光の倍率 */
  glow: number;
  caustics: number;
  shadow: number;
  /** 瓶の縁に乗る夕方の温度（0〜1） */
  rimWarm: number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** 0〜24 に折り返す */
export function wrapHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

export function lightAt(hourIn: number, keys: readonly LightKey[] = LIGHT_KEYS): LightState {
  const hour = wrapHour(hourIn);
  let i = 0;
  while (i < keys.length - 2 && hour >= keys[i + 1]!.hour) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const span = b.hour - a.hour;
  const t = span > 0 ? smooth(Math.min(Math.max((hour - a.hour) / span, 0), 1)) : 0;

  const day = mix(a.day, b.day, t);
  const dusk = mix(a.dusk, b.dusk, t);
  const night = mix(a.night, b.night, t);
  const sum = day + dusk + night || 1;

  const rimD = (hour - RIM_WARM.peakHour) / RIM_WARM.widthHours;
  return {
    day: day / sum,
    dusk: dusk / sum,
    night: night / sum,
    dawnTint: mix(a.dawnTint, b.dawnTint, t),
    key: mix3(a.keyColor, b.keyColor, t),
    keyDir: normalize(mix3(a.keyDir, b.keyDir, t)),
    ambient: mix3(a.ambient, b.ambient, t),
    glow: mix(a.glow, b.glow, t),
    caustics: mix(a.caustics, b.caustics, t),
    shadow: mix(a.shadow, b.shadow, t),
    rimWarm: Math.exp(-rimD * rimD),
  };
}

/** Date から現地時刻（時、小数） */
export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}
