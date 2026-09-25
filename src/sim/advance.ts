// 時間を進める。advance(state, 経過秒) は純関数で、固定刻みで進め、刻みに満たない端数は状態に残す。
// 同じ状態と経過からは、何回に分けて進めても同じ結果になる。
import { SIM } from '../config';
import { createRng, type Rng } from './rng';
import type { GameState } from './state';

/** 1刻み分進める（その場で書き換える）。生活環などはフェーズ3でここに足す */
function step(state: GameState, dt: number, _rng: Rng): void {
  state.time += dt;
  for (const jar of state.jars) {
    for (const c of jar.creatures) {
      c.age += dt;
      c.stageAge += dt;
    }
  }
}

/**
 * seconds 秒進めた新しい状態を返す（元の状態は変えない）。
 * 刻みの数が多すぎるときは刻みを粗くする（stepSeconds の整数倍）
 */
export function advance(state: GameState, seconds: number): GameState {
  const next = structuredClone(state);
  if (!(seconds > 0)) return next;
  let total = next.pending + seconds;
  const base = SIM.stepSeconds;
  const steps = Math.floor(total / base);
  const k = Math.max(1, Math.ceil(steps / SIM.maxSteps));
  const dt = base * k;
  const rng = createRng(next.rng);
  while (total >= dt) {
    step(next, dt, rng);
    total -= dt;
  }
  // 粗い刻みの残りは細かい刻みで
  while (total >= base) {
    step(next, base, rng);
    total -= base;
  }
  next.pending = total;
  next.rng = rng.state();
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
export function catchUp(state: GameState, nowMs: number): CatchUp {
  const diff = (nowMs - state.lastTick) / 1000;
  if (!(diff >= 0)) {
    const next = structuredClone(state);
    next.lastTick = nowMs;
    return { state: next, elapsed: 0, rewound: true };
  }
  const elapsed = Math.min(diff, SIM.maxElapsedDays * 86400);
  const next = advance(state, elapsed);
  next.lastTick = nowMs;
  return { state: next, elapsed, rewound: false };
}
