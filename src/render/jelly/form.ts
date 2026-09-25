// エフィラから成体までの形の移り変わり。育ち具合 g（0 で放されたばかりのエフィラ、1 で成体）から、
// 傘の大きさ・腕の切れ込み・触手や口腕の長さ・四つ葉の濃さ・拍動のぎこちなさを決める。
// g = 1 では成体の値（config の BELL・PULSE・SWIM）そのものになる。three.js に依存しない。
import { BELL, EPHYRA, PULSE } from '../../config';
import { ADULT_SHAPE, type ShapeParams } from './profile';

export interface JellyForm {
  /** 傘の半径（瓶の高さ単位、腕の先まで） */
  radius: number;
  /** 腕の間の切れ込みの深さ（傘の半径に対する割合）。0 で丸い傘 */
  armDepth: number;
  /** 腕の半幅（傘の半径に対する割合）。根元と先 */
  armBase: number;
  armTip: number;
  /** 腕の先の二股の切れ込み（傘の半径に対する割合） */
  lappet: number;
  /** 縁触手の生えそろい具合（0〜1）。腕の間から先に生える */
  tentacles: number;
  /** 口腕の長さの割合（成体 = 1） */
  oralArms: number;
  /** 四つ葉の濃さ（0〜1） */
  gonads: number;
  /** 放射管の枝分かれと環状管（0〜1） */
  canals: number;
  /** 拍動と泳ぎのぎこちなさ（1 でエフィラ、0 で成体） */
  jerk: number;
}

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/** 範囲 [a, b] の中での進み（0〜1、なめらか） */
export function within(g: number, range: readonly [number, number]): number {
  return smooth((g - range[0]) / (range[1] - range[0]));
}

/** 育ち具合 g の形。startRadius は放されたときの半径（確認用の実物大では小さくする） */
export function formAt(g: number, startRadius: number = EPHYRA.radius): JellyForm {
  const t = Math.min(Math.max(g, 0), 1);
  if (t >= 1) return ADULT_FORM;
  // 大きさは指数的に育つ（同じ日数で同じ倍率ずつ）
  const radius = startRadius * (BELL.radius / startRadius) ** t;
  const fill = within(t, EPHYRA.fill);
  return {
    radius,
    armDepth: EPHYRA.armDepth * (1 - fill),
    armBase: EPHYRA.armBase,
    armTip: EPHYRA.armTip,
    lappet: EPHYRA.lappet * (1 - fill),
    tentacles: within(t, EPHYRA.tentacles),
    oralArms: EPHYRA.oralArmStart + (1 - EPHYRA.oralArmStart) * within(t, EPHYRA.oralArms),
    gonads: within(t, EPHYRA.gonads),
    canals: within(t, EPHYRA.canals),
    jerk: 1 - within(t, EPHYRA.calm),
  };
}

export const ADULT_FORM: JellyForm = {
  radius: BELL.radius,
  armDepth: 0,
  armBase: EPHYRA.armBase,
  armTip: EPHYRA.armTip,
  lappet: 0,
  tentacles: 1,
  oralArms: 1,
  gonads: 1,
  canals: 1,
  jerk: 0,
};

/** 拍動の調子。成体は PULSE、エフィラは EPHYRA.pulse */
export interface PulseParams {
  contract: number;
  relax: number;
  restMin: number;
  restMax: number;
  jitter: number;
  ampMin: number;
  ampMax: number;
  strongChance: number;
  strongAmpMin: number;
  strongAmpMax: number;
  /** ときどき間が空く確率と長さ（秒）、すぐにもう一度縮む確率 */
  pauseChance: number;
  pauseMin: number;
  pauseMax: number;
  doubleChance: number;
}

export const ADULT_PULSE: PulseParams = {
  contract: PULSE.contract,
  relax: PULSE.relax,
  restMin: PULSE.restMin,
  restMax: PULSE.restMax,
  jitter: PULSE.jitter,
  ampMin: PULSE.ampMin,
  ampMax: PULSE.ampMax,
  strongChance: PULSE.strongChance,
  strongAmpMin: PULSE.strongAmpMin,
  strongAmpMax: PULSE.strongAmpMax,
  pauseChance: 0,
  pauseMin: 0,
  pauseMax: 0,
  doubleChance: 0,
};

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** ぎこちなさ jerk の拍動の調子（0 で成体そのもの） */
export function pulseParams(jerk: number): PulseParams {
  if (jerk <= 0) return ADULT_PULSE;
  const e = EPHYRA.pulse;
  const a = ADULT_PULSE;
  return {
    contract: mix(a.contract, e.contract, jerk),
    relax: mix(a.relax, e.relax, jerk),
    restMin: mix(a.restMin, e.restMin, jerk),
    restMax: mix(a.restMax, e.restMax, jerk),
    jitter: mix(a.jitter, e.jitter, jerk),
    ampMin: mix(a.ampMin, e.ampMin, jerk),
    ampMax: mix(a.ampMax, e.ampMax, jerk),
    strongChance: mix(a.strongChance, e.strongChance, jerk),
    strongAmpMin: a.strongAmpMin,
    strongAmpMax: a.strongAmpMax,
    pauseChance: e.pauseChance * jerk,
    pauseMin: e.pause[0],
    pauseMax: e.pause[1],
    doubleChance: e.doubleChance * jerk,
  };
}

/**
 * 角度 θ での、傘の縁までの長さの割合（腕の形）。腕の先で 1、腕の間の切れ込みの底で 1 - armDepth。
 * 腕は根元から先へ少し細り（半幅 armBase → armTip）、切れ込みの底は丸い。腕の先には二股の小さな切れ込み。
 * 腕の真ん中は縁弁の真ん中（θ = k·2π/lobes）。bell.ts の armR() と同じ式
 */
export function armReach(theta: number, f: Pick<JellyForm, 'armDepth' | 'armBase' | 'armTip' | 'lappet'>, lobes: number): number {
  const lobe = (Math.PI * 2) / lobes;
  const u = theta / lobe;
  const d = Math.abs(u - Math.round(u));
  const notch = f.lappet * Math.exp(-((d / EPHYRA.lappetWidth) ** 2));
  if (f.armDepth <= 1e-4) return 1 - notch;
  const floor = 1 - f.armDepth;
  // 腕の脇の線：半径 r での半幅が armBase（切れ込みの底）から armTip（先）へ細る
  const taper = (f.armBase - f.armTip) / f.armDepth;
  const side = (f.armBase + taper * floor) / (Math.sin(d * lobe) + taper);
  return Math.min(1, softMax(softMin(1, side, 0.05), floor, 0.06)) - notch;
}

function softMin(a: number, b: number, k: number): number {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
}

function softMax(a: number, b: number, k: number): number {
  return -softMin(-a, -b, k);
}

/** ぎこちなさ jerk の縮み方としなり方（0 で成体そのもの） */
export function shapeParams(jerk: number): ShapeParams {
  if (jerk <= 0) return ADULT_SHAPE;
  const a = ADULT_SHAPE;
  return {
    contractBend: mix(a.contractBend, EPHYRA.contractBend, jerk),
    bendPower: mix(a.bendPower, EPHYRA.bendPower, jerk),
    flexGain: mix(a.flexGain, EPHYRA.flexGain, jerk),
    flexSpread: mix(a.flexSpread, EPHYRA.flexSpread, jerk),
    lobeLag: EPHYRA.armLag * jerk,
  };
}
