// ゲームの状態を持ち、時間を進め、保存する。
// 起動時と画面に戻ったときに、閉じていた分を固定刻みで一気に進める（sim/advance.ts）。
// 開いている間に進めるときは、見ている瓶を伝える（その瓶の出来事は日誌に書かず、水換えも起きない）。
// 保存は設定を変えたとき、開いている間は一定の間隔で、画面を離れる直前に。
import { LIFE, SIM, type LifeRules } from './config';
import { canMove, moveCreature, renameCreature, type MoveResult } from './sim/actions';
import { addPhoto, checkFacts, hasFact, hasNewFacts, markFactsSeen, noteFact, photoIds, removePhoto, replacePhoto, type FactKey, type PhotoResult, type SpeciesPhoto } from './sim/book';
import { catchUp } from './sim/advance';
import type { Clock } from './sim/clock';
import { canFeed, feedJar, type FeedResult } from './sim/feed';
import { canPlace, pickFind, placeFind, setFindPhoto, type PlaceResult } from './sim/finds';
import { stirJar } from './sim/growth';
import { canSend, openLetter, sendCreature, type SendResult } from './sim/uncle';
import { hasUnread } from './sim/journal';
import { createInitialState, type GameState, type Settings, type Species } from './sim/state';
import { memoryPhotos, openStores, type PhotoStore, type StateStore } from './storage/db';
import { exportState, importAll } from './storage/io';
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
  /** 開いている間に見ている瓶（tick で受け取る） */
  private watching: number | null = null;

  private constructor(
    private readonly clock: Clock,
    private readonly store: StateStore,
    state: GameState,
    /** 読めない新しい版のデータがあったときは、上書きしないよう保存しない */
    private readonly readOnly: boolean,
    /** 種のページの写真の入れ物と、読み込んだ写真（番号 → 画像） */
    private readonly photoStore: PhotoStore,
    private readonly photos: Map<number, string>,
  ) {
    this.current = state;
  }

  /** 保存を読み込み、閉じていた分を進めて始める */
  static async start(clock: Clock, store?: StateStore, photoStore?: PhotoStore): Promise<Game> {
    const opened = store ? { state: store, photos: photoStore ?? memoryPhotos() } : await openStores();
    const s = opened.state;
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
    let photos = new Map<number, string>();
    try {
      photos = await opened.photos.load();
    } catch {
      // 写真が読めなくても動く
    }
    const game = new Game(clock, s, state ?? createInitialState(now), readOnly, opened.photos, photos);
    game.catchUpNow(true, null);
    // 最初に瓶を開いたとき（の豆知識）
    game.noteFact('open');
    game.prunePhotos();
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

  /**
   * 開いている間、ときどき呼ぶ。時計に合わせて進め、間隔が空いたら保存する。
   * watching は画面で見ている瓶（その瓶の出来事は日誌に書かない）
   */
  tick(watching: number | null): void {
    this.watching = watching;
    this.catchUpNow(false, watching);
    if (this.clock.wallNow() - this.lastSaveWall >= SIM.saveIntervalSeconds * 1000) void this.save();
  }

  /** 画面に戻ったとき（と、確認用に時計を動かしたとき）：離れていた分を進めて保存する（見ていなかったので、どの瓶の出来事も書く） */
  resume(): void {
    this.catchUpNow(true, null);
    void this.save();
  }

  /** 種のページに、まだ読んでいない豆知識があるか（付箋「種」と日誌のアイコンに点） */
  get newFacts(): boolean {
    return hasNewFacts(this.current);
  }

  /** 豆知識のきっかけ（画面の出来事：つついた、虫眼鏡を当てた、種のページを開いた、逆さまになった など）。足したら true */
  noteFact(key: FactKey): boolean {
    if (hasFact(this.current, key)) return false;
    const next = structuredClone(this.current);
    if (!noteFact(next, key, this.clock.now())) return false;
    this.current = next;
    this.emit();
    void this.save();
    return true;
  }

  /** 逆さまから起き直るミズクラゲを見た（回数を数え、五回で豆知識） */
  countRighted(): void {
    const next = structuredClone(this.current);
    next.book.counts.righted++;
    checkFacts(next, this.clock.now());
    this.current = next;
    this.emit();
    void this.save();
  }

  /** 種のページを開いた：豆知識をすべて読んだことにする */
  markFactsSeen(): void {
    const next = structuredClone(this.current);
    if (!markFactsSeen(next)) return;
    this.current = next;
    this.emit();
    void this.save();
  }

  /** 種のページの写真（なければ undefined） */
  photo(id: number): string | undefined {
    return this.photos.get(id);
  }

  /** 種のページに写真を貼る。いっぱいなら 'full'（replacePhoto で入れ替える） */
  addPhoto(species: Species, url: string, meta: Omit<SpeciesPhoto, 'id'>): PhotoResult {
    const next = structuredClone(this.current);
    const r = addPhoto(next, species, meta);
    if (r.result !== 'added') return r.result;
    this.storePhoto(r.id, url);
    this.current = next;
    this.emit();
    void this.save();
    return 'added';
  }

  /** 写真 oldId を新しい写真と入れ替える */
  replacePhoto(oldId: number, url: string, meta: Omit<SpeciesPhoto, 'id'>): boolean {
    const next = structuredClone(this.current);
    const id = replacePhoto(next, oldId, meta);
    if (id < 0) return false;
    this.storePhoto(id, url);
    this.dropPhoto(oldId);
    this.current = next;
    this.emit();
    void this.save();
    return true;
  }

  /** 写真をはがす（取り消せない） */
  removePhoto(id: number): void {
    const next = structuredClone(this.current);
    if (!removePhoto(next, id)) return;
    this.dropPhoto(id);
    this.current = next;
    this.emit();
    void this.save();
  }

  private storePhoto(id: number, url: string): void {
    this.photos.set(id, url);
    if (!this.readOnly) void this.photoStore.put(id, url).catch(() => {});
  }

  private dropPhoto(id: number): void {
    this.photos.delete(id);
    if (!this.readOnly) void this.photoStore.remove(id).catch(() => {});
  }

  /** 状態が持っていない写真を消す（入れ替えや読み込みの途中で閉じたときの残り） */
  private prunePhotos(): void {
    const keep = photoIds(this.current);
    for (const id of [...this.photos.keys()]) if (!keep.has(id)) this.dropPhoto(id);
  }

  /** 日誌に未読の出来事があるか */
  get unread(): boolean {
    return hasUnread(this.current);
  }

  /** 日誌を開いた：今までの出来事を読んだことにする */
  markJournalRead(): void {
    if (!this.unread) return;
    this.current = { ...this.current, journalSeen: this.current.journal.length };
    this.emit();
    void this.save();
  }

  updateSettings(patch: Partial<Settings>): void {
    this.current = { ...this.current, settings: { ...this.current.settings, ...patch } };
    this.emit();
    void this.save();
  }

  /** 個体を瓶 toJar へ移せるか（'moved' なら移せる） */
  canMove(id: number, toJar: number): MoveResult {
    return canMove(this.current, id, toJar, this.rules);
  }

  /** 個体を瓶 toJar へ移す（泳ぐ個体だけ。移し先が上限なら移さない） */
  moveCreature(id: number, toJar: number): MoveResult {
    const next = structuredClone(this.current);
    const result = moveCreature(next, id, toJar, this.rules);
    if (result !== 'moved') return result;
    noteFact(next, 'move', this.clock.now());
    this.current = next;
    this.emit();
    void this.save();
    return result;
  }

  /** 瓶 jar に今、餌をやれるか（'fed' ならやれる。1日1回、食べる個体がいる瓶だけ） */
  canFeed(jar: number): FeedResult {
    return canFeed(this.current, jar, this.clock.now());
  }

  /** 瓶 jar に餌をやる。食べた量はこの時点で決まる（見た目はそれを見せるだけ） */
  feed(jar: number): FeedResult {
    // やった時刻をそのまま記録できるよう、先に今まで進める（餌をやる瓶を見ている）
    this.catchUpNow(false, jar);
    const next = structuredClone(this.current);
    const result = feedJar(next, jar, this.clock.now());
    if (result !== 'fed') return result;
    // 餌をやった回数（豆知識のきっかけ）。カブトクラゲのいる瓶なら、そちらも数える
    next.book.counts.feeds++;
    if (next.jars[jar]?.creatures.some((c) => c.species === 'bolinopsis')) next.book.counts.bolinopsisFeeds++;
    checkFacts(next, this.clock.now());
    this.current = next;
    this.emit();
    void this.save();
    return result;
  }

  /**
   * 瓶 jar を揺らした：その瓶の水が数時間「動いた」状態になり、その間だけエフィラの育ちがわずかに早まる。
   * 何度揺らしても量は増えず、時間が延びるだけ。日誌には書かない
   */
  stir(jar: number): void {
    this.catchUpNow(false, jar);
    const next = structuredClone(this.current);
    if (!stirJar(next, jar)) return;
    this.current = next;
    this.emit();
    void this.save();
  }

  /** 個体を、おじさんのところへ送れるか（泳ぐ個体だけ） */
  canSend(id: number): SendResult {
    return canSend(this.current, id);
  }

  /**
   * 個体を、おじさんのところへ送る。瓶からいなくなり「送った子」として残る。日誌に一行。
   * 返事が届くかは、ここで決まる（珍しい子ほど届きやすい）
   */
  send(id: number): SendResult {
    this.catchUpNow(false, this.watching);
    const next = structuredClone(this.current);
    const result = sendCreature(next, id, this.rules);
    if (result !== 'sent') return result;
    this.current = next;
    this.emit();
    void this.save();
    return result;
  }

  /** 封筒を開いた（最初の手紙）。日誌のその日のページに留まる */
  openLetter(id: number): void {
    const next = structuredClone(this.current);
    if (!openLetter(next, id)) return;
    this.current = next;
    this.emit();
    void this.save();
  }

  /**
   * 瓶底の拾いもの id を拾って標本へ移す。初めて拾ったなら、拾った日と写真（photo、撮れなければ null）を残す。
   * 日誌には書かない。拾えたら true
   */
  pickFind(id: number, photo: string | null): boolean {
    this.catchUpNow(false, this.watching);
    const next = structuredClone(this.current);
    if (!pickFind(next, id, this.clock.now())) return false;
    if (photo) setFindPhoto(next, id, photo);
    this.current = next;
    this.emit();
    void this.save();
    return true;
  }

  /** 標本の物 id を瓶 jar に沈められるか（標本にあって、まだどの瓶にも沈めていない物） */
  canPlaceFind(id: number, jar: number): PlaceResult {
    return canPlace(this.current, id, jar);
  }

  /** 標本の物 id を瓶 jar に沈める（場所は空いた所を選ぶ。前に沈めた物は黙って標本へ戻る）。日誌には書かない */
  placeFind(id: number, jar: number): PlaceResult {
    this.catchUpNow(false, this.watching);
    const next = structuredClone(this.current);
    const result = placeFind(next, id, jar);
    if (result !== 'placed') return result;
    this.current = next;
    this.emit();
    void this.save();
    return result;
  }

  /** 沈めてある物 id を引き上げて標本へ戻す（瓶でタップしたのと同じ。写真と拾った日はそのまま） */
  raiseFind(id: number): boolean {
    return this.pickFind(id, null);
  }

  /** 名前を付ける（null や空なら名無しに戻す） */
  rename(id: number, name: string | null): void {
    const next = structuredClone(this.current);
    if (!renameCreature(next, id, name)) return;
    this.current = next;
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
    for (const id of [...this.photos.keys()]) this.dropPhoto(id);
    this.current = createInitialState(this.clock.now());
    this.lastCatchUp = 0;
    this.rewound = false;
    this.emit();
    void this.save();
  }

  exportJson(): string {
    return exportState(this.current, this.clock.now(), this.photos);
  }

  /** 書き出したデータを読み込む（種のページの写真も）。読み込んだ時点から先へ進む（書き出してからの分は進めない） */
  importJson(text: string): void {
    const { state, photos } = importAll(text);
    state.lastTick = this.clock.now();
    // 画像のない写真は貼っていないことにする
    for (const r of state.book.species) r.photos = r.photos.filter((p) => photos.has(p.id));
    for (const id of [...this.photos.keys()]) this.dropPhoto(id);
    for (const [id, url] of photos) this.storePhoto(id, url);
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

  /** 時計に合わせて進める。record なら、進めた分と巻き戻しの有無を覚えておく（確認用の表示）。watching は見ている瓶 */
  private catchUpNow(record: boolean, watching: number | null): void {
    const r = catchUp(this.current, this.clock.now(), this.rules, watching);
    // 状態から分かる豆知識のきっかけ（見つけた日は今日）
    checkFacts(r.state, this.clock.now());
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
