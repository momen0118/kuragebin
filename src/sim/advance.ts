// 時間を進める。advance(state, 経過秒) は純関数で、固定刻みで進め、刻みに満たない端数は状態に残す。
// 同じ状態と経過からは、何回に分けて進めても同じ結果になる。
import { LIFE, SIM, type LifeRules } from '../config';
import { stepLife } from './lifecycle';
import { createRng, type Rng } from './rng';
import type { GameState } from './state';

/** 1刻み分進める（その場で書き換える）。wallBase + time·1000 がその時点の端末の時刻 */
function step(state: GameState, dt: number, rng: Rng, rules: LifeRules, wallBase: number): void {
  state.time += dt;
  stepLife(state, dt, { rng, rules, wall: wallBase + state.time * 1000 });
}

/**
 * seconds 秒進めた新しい状態を返す（元の状態は変えない）。
 * 刻みの数が多すぎるときは刻みを粗くする（stepSeconds の整数倍）。
 * rules は生活環の期間と上限（ふだんは config の LIFE。確認用に差し替えられる）
 */
export function advance(state: GameState, seconds: number, rules: LifeRules = LIFE): GameState {
  const next = structuredClone(state);
  if (!(seconds > 0)) return next;
  // lastTick は time + pending の時点に当たる。出来事の端末の時刻はここから数える
  const wallBase = next.lastTick - (next.time + next.pending) * 1000;
  let total = next.pending + seconds;
  const base = SIM.stepSeconds;
  const steps = Math.floor(total / base);
  const k = Math.max(1, Math.ceil(steps / SIM.maxSteps));
  const dt = base * k;
  const rng = createRng(next.rng);
  while (total >= dt) {
    step(next, dt, rng, rules, wallBase);
    total -= dt;
  }
  // 粗い刻みの残りは細かい刻みで
  while (total >= base) {
    step(next, base, rng, rules, wallBase);
    total -= base;
  }
  next.pending = total;
  next.rng = rng.state();
  next.lastTick = state.lastTick + seconds * 1000;
  return next;
}

export interface CatchUp {
  state: GameState;
  /** 実際に進めた秒数（上限で打ち切った後） */
  elapsed: number;
  /** 端末の時計が巻き戻っていた */
  rewound: boolean;
}

/**
 * 最後に進めた時刻から nowMs までの分を進める。
 * 上限（maxElapsedDays）を越える分は捨て、端末の時計が巻き戻っていたら経過0として何も壊さない
 */
export function catchUp(state: GameState, nowMs: number, rules: LifeRules = LIFE): CatchUp {
  const diff = (nowMs - state.lastTick) / 1000;
  if (!(diff >= 0)) {
    const next = structuredClone(state);
    next.lastTick = nowMs;
    return { state: next, elapsed: 0, rewound: true };
  }
  const elapsed = Math.min(diff, SIM.maxElapsedDays * 86400);
  // 打ち切ったときは、今から上限の分だけさかのぼった所から進めたことにする（出来事の時刻が今につながる）
  const start = elapsed < diff ? { ...state, lastTick: nowMs - elapsed * 1000 } : state;
  const next = advance(start, elapsed, rules);
  next.lastTick = nowMs;
  return { state: next, elapsed, rewound: false };
}
