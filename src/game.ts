// ゲームの状態を持ち、時間を進め、保存する。
// 起動時と画面に戻ったときに、閉じていた分を固定刻みで一気に進める（sim/advance.ts）。
// 保存は設定を変えたとき、開いている間は一定の間隔で、画面を離れる直前に。
import { LIFE, SIM, type LifeRules } from './config';
import { catchUp } from './sim/advance';
import type { Clock } from './sim/clock';
import { createInitialState, type GameState, type Settings } from './sim/state';
import { openStateStore, type StateStore } from './storage/db';
import { exportState, importState } from './storage/io';
import { migrate, SchemaError } from './storage/schema';

export interface GameInfo {
  /** 保存できる環境か */
  persistent: boolean;
  /** 最後に保存した時刻（端末のミリ秒、まだなら 0） */
  savedAt: number;
  /** 起動時・復帰時に進めた秒数と、時計の巻き戻しがあったか */
  lastCatchUp: number;
  rewound: boolean;
}

export class Game {
  private current: GameState;
  private readonly listeners = new Set<(s: GameState) => void>();
  private saving: Promise<void> = Promise.resolve();
  private lastSaveWall = 0;
  private savedAt = 0;
  private lastCatchUp = 0;
  private rewound = false;
  /** 生活環の期間と上限（確認用に差し替えられる） */
  private rules: LifeRules = LIFE;

  private constructor(
    private readonly clock: Clock,
    private readonly store: StateStore,
    state: GameState,
    /** 読めない新しい版のデータがあったときは、上書きしないよう保存しない */
    private readonly readOnly: boolean,
  ) {
    this.current = state;
  }

  /** 保存を読み込み、閉じていた分を進めて始める */
  static async start(clock: Clock, store?: StateStore): Promise<Game> {
    const s = store ?? (await openStateStore());
    const now = clock.now();
    let state: GameState | null = null;
    let readOnly = false;
    try {
      const raw = await s.load();
      if (raw) {
        try {
          state = migrate(raw);
        } catch (e) {
          if (e instanceof SchemaError && e.message.startsWith('新しい版')) {
            readOnly = true;
          } else {
            // 読めなかったデータは消さずに取っておき、新しく始める
            await s.keep(`broken-${now}`, raw);
          }
        }
      }
    } catch {
      // 読み込みに失敗しても、新しい状態で動く
    }
    const game = new Game(clock, s, state ?? createInitialState(now), readOnly);
    game.catchUpNow(true);
    await game.save();
    return game;
  }

  get state(): GameState {
    return this.current;
  }

  get info(): GameInfo {
    return { persistent: this.store.persistent && !this.readOnly, savedAt: this.savedAt, lastCatchUp: this.lastCatchUp, rewound: this.rewound };
  }

  onChange(fn: (s: GameState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 開いている間、ときどき呼ぶ。時計に合わせて進め、間隔が空いたら保存する */
  tick(): void {
    this.catchUpNow(false);
    if (this.clock.wallNow() - this.lastSaveWall >= SIM.saveIntervalSeconds * 1000) void this.save();
  }

  /** 画面に戻ったとき（と、確認用に時計を動かしたとき）：離れていた分を進めて保存する */
  resume(): void {
    this.catchUpNow(true);
    void this.save();
  }

  updateSettings(patch: Partial<Settings>): void {
    this.current = { ...this.current, settings: { ...this.current.settings, ...patch } };
    this.emit();
    void this.save();
  }

  get lifeRules(): LifeRules {
    return this.rules;
  }

  /** 確認用：生活環の期間や上限を差し替える（保存しない。開き直すと config の値に戻る） */
  setRules(patch: Partial<LifeRules>): void {
    this.rules = { ...this.rules, ...patch };
    this.emit();
  }

  /** 確認用：状態を書き換える（デバッグパネルから） */
  edit(fn: (s: GameState, rules: LifeRules) => void): void {
    const next = structuredClone(this.current);
    fn(next, this.rules);
    this.current = next;
    this.emit();
    void this.save();
  }

  /** 状態を最初からにする（確認用） */
  reset(): void {
    this.current = createInitialState(this.clock.now());
    this.lastCatchUp = 0;
    this.rewound = false;
    this.emit();
    void this.save();
  }

  exportJson(): string {
    return exportState(this.current, this.clock.now());
  }

  /** 書き出したデータを読み込む。読み込んだ時点から先へ進む（書き出してからの分は進めない） */
  importJson(text: string): void {
    const state = importState(text);
    state.lastTick = this.clock.now();
    this.current = state;
    this.lastCatchUp = 0;
    this.rewound = false;
    this.emit();
    void this.save();
  }

  /** 保存する。書き込みは順番に一つずつ */
  save(): Promise<void> {
    if (this.readOnly) return Promise.resolve();
    const snapshot = this.current;
    this.lastSaveWall = this.clock.wallNow();
    this.saving = this.saving
      .then(() => this.store.save(snapshot))
      .then(() => {
        this.savedAt = this.clock.wallNow();
      })
      .catch(() => {
        // 保存に失敗しても動き続ける。次の機会にまた保存する
      });
    return this.saving;
  }

  /** 時計に合わせて進める。record なら、進めた分と巻き戻しの有無を覚えておく（確認用の表示） */
  private catchUpNow(record: boolean): void {
    const r = catchUp(this.current, this.clock.now(), this.rules);
    this.current = r.state;
    if (record) {
      this.lastCatchUp = r.elapsed;
      this.rewound = r.rewound;
    }
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current);
  }
}
