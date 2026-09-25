// ポリプとストロビラの体の断面。瓶底から立つ小さなラッパ形で、口の縁に触手の輪、真ん中に口（口丘）。
// ストロビラになると縦に伸び、横の筋がだんだん深いくびれになって皿を積んだ形になり、皿の縁に腕の形が出る。
// 断面は体の高さ = 1 の単位で、足の中心（軸）から側面を上り、口の縁を回って口の先（軸）まで。
// 弧の長さで等間隔に並べ直し、描画側（polyp.ts）は回転体の頂点シェーダで使う。three.js に依存しない。
import { POLYP, STROBILA } from '../../config';
import { within } from './form';

/** 断面の点の数 - 1 */
export const POLYP_PROFILE_N = 96;
/** 1点あたりの値：半径, 高さ, 腕の形の強さ（皿の縁で 1）, 皿の番号（下から 1, 2, 3。皿でなければ 0） */
export const POLYP_PROFILE_STRIDE = 4;

export interface PolypShapeInput {
  /** ストロビラの進み（0〜1）。ポリプなら 0 */
  strobila: number;
  /** 皿の数（放すエフィラの数）と、もう離れた数（上から） */
  discs: number;
  released: number;
  /** 杯（口の縁まで）の育ち具合。エフィラを放したあとの生え直しで 0 から 1 へ。ふだんは 1 */
  calyx: number;
  /** つつかれて縮んだ度合い（0〜1） */
  contract: number;
  /** 皿の半径（体の高さ = 1） */
  discRadius: number;
}

export interface PolypShape {
  /** 断面の点（POLYP_PROFILE_STRIDE 個ずつ、POLYP_PROFILE_N + 1 点） */
  points: Float32Array;
  /** 口の縁（触手の根元）の半径と高さ */
  rimR: number;
  rimY: number;
  /** 残っている皿の中心の高さ（下から）と、そのいちばん上の皿の縁の半径 */
  discY: number[];
  topDiscR: number;
}

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** ポリプの側面の半径（高さ h、杯の高さ cz、口の縁の半径 rc） */
function polypSide(h: number, cz: number, rc: number): number {
  const P = POLYP;
  const foot = P.footRadius + (P.stalkRadius - P.footRadius) * smooth(h / 0.08);
  if (h <= P.flareStart) return foot;
  // 杯：茎から口の縁へラッパのように開く
  const u = Math.min((h - P.flareStart) / Math.max(cz, 1e-3), 1);
  return P.stalkRadius + (rc - P.stalkRadius) * u ** 1.8;
}

interface Sample {
  r: number;
  y: number;
  lobe: number;
  disc: number;
}

/** 断面を作る。out を渡せば使い回す */
export function polypShape(input: PolypShapeInput, out?: PolypShape): PolypShape {
  const P = POLYP;
  const S = STROBILA;
  const p = input.strobila;
  const left = Math.max(0, input.discs - input.released);
  const k = input.contract;
  // 縮むと背が低くなり、少し太る
  const squash = 1 - P.pokeBody * k;
  const fat = 1 + 0.25 * P.pokeBody * k;

  // 杯の高さと口の縁の半径（生え直しの途中は小さい）。縮むと杯がすぼまる
  const cz = (1 - P.flareStart) * mix(0.12, 1, input.calyx);
  const rc = mix(P.stalkRadius * 1.6, P.calyxRadius, input.calyx) * (1 - 0.4 * k);
  const hb = P.flareStart;

  // ストロビラ：杯のあたりが伸びて left 枚の皿に分かれる
  const stretchT = within(p, S.stretch);
  const constrictT = within(p, S.constrict);
  const lobeT = within(p, S.lobes);
  const widenT = within(p, [S.constrict[0], S.lobes[1]]);
  const strob = input.discs > 0 && p > 0;
  const zone = strob ? mix(cz, Math.max(left * S.discHeight, left > 0 ? 0.3 : 0.12), stretchT) : cz;
  const top = hb + zone;

  const samples: Sample[] = [{ r: 0, y: 0, lobe: 0, disc: 0 }];
  const side = 150;
  const discY: number[] = [];
  const neck = 1 - constrictT * S.constrictDepth;
  for (let i = 0; i <= side; i++) {
    const y = (top * i) / side;
    let r = polypSide(y < hb ? y : hb + ((y - hb) / Math.max(zone, 1e-3)) * cz, cz, rc);
    let lobe = 0;
    let disc = 0;
    if (strob && left > 0 && y > hb) {
      // 皿の段：下から segment 番目、その中の位置 v
      const seg = zone / left;
      const f = (y - hb) / seg;
      const n = Math.min(Math.floor(f), left - 1);
      const v = f - n;
      const R = mix(r, input.discRadius, widenT);
      // いちばん上の皿は、まだ1枚も離れていなければ上半分が口のまわり（くびれない）
      const cup = n === left - 1 && input.released === 0;
      // くびれ：段の境目で細く、皿の縁で太い。縁は段の下寄りで、下から急に張り出し、上へはなだらかに
      const vr = S.discRim;
      const bump = cup && v > vr ? 1 : v < vr ? Math.sin(((Math.PI / 2) * v) / vr) ** 0.7 : Math.cos(((Math.PI / 2) * (v - vr)) / (1 - vr)) ** (1 + constrictT);
      r = R * (neck + (1 - neck) * bump);
      lobe = lobeT * Math.exp(-(((v - vr) / 0.16) ** 2));
      disc = n + 1;
    }
    samples.push({ r: r * fat, y: y * squash, lobe, disc });
  }
  for (let n = 0; n < left && strob; n++) discY.push((hb + (zone / left) * (n + S.discRim)) * squash);

  // 口の縁（丸い唇）→ 口盤のくぼみ → 口丘の先（軸）
  const last = samples[samples.length - 1]!;
  const rimR = last.r;
  const rimY = last.y;
  const lip = 0.035 * mix(0.5, 1, input.calyx);
  samples.push({ r: rimR * 0.99, y: rimY + lip * 0.6, lobe: last.lobe * 0.5, disc: last.disc });
  samples.push({ r: rimR * 0.9, y: rimY + lip * 0.7, lobe: 0, disc: last.disc });
  const mouthR = Math.min(P.mouthRadius * fat, rimR * 0.55);
  const dipY = rimY + lip * 0.7 - P.oralDip * squash * mix(0.4, 1, input.calyx);
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    samples.push({ r: mix(rimR * 0.9, mouthR, t), y: mix(rimY + lip * 0.7, dipY, smooth(t)), lobe: 0, disc: last.disc });
  }
  const tipY = dipY + P.mouthHeight * squash * mix(0.5, 1, input.calyx) * (1 - 0.5 * k);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    // 口丘はなめらかな円錐（先は丸い）
    samples.push({ r: mouthR * (1 - t) ** 1.4, y: mix(dipY, tipY, Math.sin((t * Math.PI) / 2)), lobe: 0, disc: last.disc });
  }

  // 弧の長さで並べ直す
  const n = POLYP_PROFILE_N;
  const len = new Float64Array(samples.length);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    len[i] = len[i - 1]! + Math.hypot(b.r - a.r, b.y - a.y);
  }
  const total = len[samples.length - 1]! || 1;
  const pts = out?.points ?? new Float32Array((n + 1) * POLYP_PROFILE_STRIDE);
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const want = (total * i) / n;
    while (j < samples.length - 1 && len[j]! < want) j++;
    const a = samples[j - 1]!;
    const b = samples[j]!;
    const span = len[j]! - len[j - 1]!;
    const t = span > 1e-9 ? Math.min(Math.max((want - len[j - 1]!) / span, 0), 1) : 0;
    const o = i * POLYP_PROFILE_STRIDE;
    pts[o] = mix(a.r, b.r, t);
    pts[o + 1] = mix(a.y, b.y, t);
    pts[o + 2] = mix(a.lobe, b.lobe, t);
    pts[o + 3] = t < 0.5 ? a.disc : b.disc;
  }
  const res = out ?? { points: pts, rimR: 0, rimY: 0, discY: [], topDiscR: 0 };
  res.rimR = rimR;
  res.rimY = rimY + lip * 0.6;
  res.discY = discY;
  res.topDiscR = strob && left > 0 ? mix(rc, input.discRadius, widenT) * fat : 0;
  return res;
}
