import './style.css';
import { Vector3 } from 'three';
import { BOOK, FIND_LOOK, HANDLING, KICK, LOUPE, MOTION, NOTEBOOK, QUALITY, ROOMS, SAKURA, SIM, SLOSH, UNCLE, type RoomName } from './config';
import { DebugPanel } from './debug/panel';
import { Game } from './game';
import { App } from './render/app';
import { hourOf, lightAt, sunOf, type LightState } from './render/lighting';
import { Clock } from './sim/clock';
import { closeAllFacts, openAllFacts } from './sim/book';
import { broodNow, clearFed, clearFinds, clearMeals, clearSpecimens, editGenes, editSex, growAdult, growFull, hatchNow, layEggsNow, skipMaturity, fillAdults, removeCreature, setDiscs, setProgress, setSediment, setStage, spawnCreature, spawnFind, type GeneEdit, type SexEdit } from './sim/edit';
import { feedingPlan, lastMealAt } from './sim/feed';
import { inSakuraSeason, petalOf, type Petal } from './sim/season';
import { broodAmount } from './sim/sex';
import { DEFAULT_SETTINGS, gameNow, type GameState, type Letter, type Settings, type Species, type Stage } from './sim/state';
import { deliverGiftNow, deliverReplyNow, resetFirstLetter } from './sim/uncle';
import { Carry } from './ui/carry';
import { JarDots } from './ui/dots';
import { FeedButton } from './ui/feedButton';
import { Gestures, type Point } from './ui/gestures';
import { JournalButton } from './ui/journal/button';
import { Notebook } from './ui/journal/notebook';
import { sexLabel } from './ui/journal/pages';
import { JarSlider } from './ui/jarSlider';
import { LampToggle } from './ui/lampToggle';
import { flyLight } from './ui/finds';
import { shouldDraw } from './ui/frameCap';
import { Envelope, LetterReader } from './ui/letters';
import { PetalView } from './ui/petal';
import { Loupe } from './ui/loupe';
import { DebugMotion, DeviceMotionSource } from './ui/motion';
import { ShakeDetector } from './ui/motionFilter';
import { SendConfirm, SendHint } from './ui/sendConfirm';
import { CreatureTag } from './ui/tag';
import { registerServiceWorker } from './pwa/register';
import { Sound, type SoundName, type SoundOptions } from './sound/sound';

const params = new URLSearchParams(location.search);
// ?debug のほか、クエリを渡せない環境のために #debug でも開ける
const debug = params.has('debug') || location.hash === '#debug';
/** 確認用（?debug のときだけ）：自動では進めず、外から1コマずつ進める */
const capture = debug && params.has('capture');

/** 開いたときに先に読み込む部屋の覚え（この端末だけの手がかり。正は保存した設定） */
const ROOM_HINT_KEY = 'kuragebin.room';

function roomHint(): RoomName {
  try {
    const v = localStorage.getItem(ROOM_HINT_KEY);
    if (v === 'home' || v === 'lab') return v;
  } catch {
    // 覚えが読めなくても、保存した設定に合わせ直す
  }
  return DEFAULT_SETTINGS.room;
}

function rememberRoom(room: RoomName): void {
  try {
    localStorage.setItem(ROOM_HINT_KEY, room);
  } catch {
    // 覚えられなくても動く（次に開いたとき、読み込んでから部屋を合わせる）
  }
}

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * 描く大きさ（CSS px）。iOS のホーム画面から開いたときは、画面の下まで描けるよう画面の大きさも見る
 * （上端の時計の帯の裏まで描く設定では、高さが帯の分だけ短く報告され、ページもその高さで切られる）
 */
function viewportSize(): [number, number] {
  const w = window.innerWidth;
  let h = Math.max(window.innerHeight, document.documentElement.clientHeight);
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) {
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const [sw, sh] = h >= w ? [short, long] : [long, short];
    // 画面の幅いっぱいに開いているときだけ（iPad の分割表示などは除く）
    if (Math.abs(w - sw) < 2 && sh > h) h = sh;
  }
  return [w, h];
}

let laidOut = '';

/** 画面いっぱいに描く（写真より横長なら、写真の左右は黒に溶かす）。大きさが変わっていなければ何もしない */
function layout(canvas: HTMLCanvasElement, app: App): void {
  const [vw, vh] = viewportSize();
  const dpr = window.devicePixelRatio || 1;
  const key = `${vw}x${vh}@${dpr}/${app.maxDpr}`;
  if (key === laidOut) return;
  laidOut = key;
  // 報告された高さより画面が長いときは、ページそのものも画面の下まで伸ばす。
  // 描く範囲だけ伸ばしても、ページの高さより下は表示されない
  const tall = vh > window.innerHeight ? `${vh}px` : '';
  document.documentElement.style.height = tall;
  document.body.style.height = tall;
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;
  app.resize(vw, vh, dpr);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  if (!supportsWebGL2()) {
    document.getElementById('fallback')!.hidden = false;
    return;
  }

  // 保存を読み込み、閉じていた分を進める（描画の準備と並行して）
  const clock = new Clock();
  const gameReady = Game.start(clock);

  const app = new App(canvas);
  if (debug) {
    // 確認用：中間の画像を出す（?view=bg / contents / glow / room）、部品を隠す（?hide=snow,table など）
    app.debugView = params.get('view');
    // 撮影用：細部を見るためにデバイスピクセル比の上限を上げる（?maxdpr=4）
    const maxDpr = Number(params.get('maxdpr'));
    if (maxDpr > 0) app.maxDpr = app.maxDprOverride = maxDpr;
    app.setPatternDebug(params.has('pattern'));
    for (const name of (params.get('hide') ?? '').split(',')) {
      const part = app.parts[name];
      if (part) part.visible = false;
    }
  }
  layout(canvas, app);
  window.addEventListener('resize', () => layout(canvas, app));
  // ページを伸ばしたときに、何かの拍子でずれないように（画面は動かさない）
  window.addEventListener('scroll', () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  });
  const [game] = await Promise.all([gameReady, app.load(import.meta.env.BASE_URL, roomHint())]);

  /** 部屋（背景の写真の組）を設定に合わせる（写真と、部屋ごとの位置合わせ・天板の光の強さ） */
  const applyRoom = async (): Promise<void> => {
    const room = game.state.settings.room;
    rememberRoom(room);
    await app.setRoom(room);
  };
  await applyRoom();
  /** 部屋を変える（日誌の設定） */
  const setRoom = (room: RoomName): void => {
    if (game.state.settings.room === room) return;
    game.updateSettings({ room });
    void applyRoom();
  };

  /** 画質（日誌の設定）：描く解像度・マリンスノーの数・虫眼鏡の描き方を合わせ、描き直す大きさを決め直す。1秒に描く回数はループで */
  const applyQuality = (): void => {
    app.setQuality(game.state.settings.quality);
    layout(canvas, app);
  };
  const setQuality = (q: Settings['quality']): void => {
    if (game.state.settings.quality === q) return;
    game.updateSettings({ quality: q });
    applyQuality();
  };
  applyQuality();

  // 音（初期はオフ）。iOS は利用者の操作の中でしか鳴らしはじめられないので、タップのたびに鳴らせる状態にしなおす
  const sound = new Sound();
  sound.setEnabled(game.state.settings.sound);
  for (const type of ['pointerup', 'touchend', 'click']) window.addEventListener(type, () => sound.unlock(), { capture: true, passive: true });
  app.onSound = (name, opts) => sound.play(name, opts);
  const setSound = (on: boolean): void => {
    game.updateSettings({ sound: on });
    sound.setEnabled(on);
  };

  // 3つの瓶。前回見ていた瓶から始め、スワイプで落ち着いた瓶を覚えておく
  const slider = new JarSlider(SIM.jarCount, game.state.settings.jar, () => app.jarStepPx);
  app.setView(slider.position);
  const dots = new JarDots(SIM.jarCount);
  dots.set(slider.position);
  let refreshPanel = (): void => {};
  slider.onSettle = (i) => {
    if (game.state.settings.jar !== i) game.updateSettings({ jar: i });
    refreshPanel();
  };
  /** 読み込んだ状態などに合わせて、すぐにその瓶にする */
  const jumpToSavedJar = (): void => {
    slider.set(game.state.settings.jar);
    app.setView(slider.position);
  };

  // 個体の札（タップで出る）。名前を付けられる
  const tag = new CreatureTag({
    info: (id) => {
      const s = game.state;
      const c = s.jars[slider.index]?.creatures.find((x) => x.id === id);
      if (!c) return null;
      return { name: c.name, stage: c.stage, sex: sexLabel(c), day: Math.floor(Math.max(0, s.time - c.arrivedAt) / 86400) + 1 };
    },
    anchor: (id) => app.noteAnchor(id, canvas.clientWidth, canvas.clientHeight),
    rename: (id, name) => game.rename(id, name),
    look: (id) => loupe.lookAt(id),
    shoot: (id) => shoot(id),
  });

  // 虫眼鏡。部屋に一つだけ、天板に置いてある（瓶ではなく部屋の側。瓶を切り替えても動かない）
  const loupe = new Loupe({
    rest: () => ({ ...app.roomPoint(LOUPE.rest[0], LOUPE.rest[1], canvas.clientWidth, canvas.clientHeight), alpha: 1 }),
    target: (id) => (app.atRest ? app.noteAnchor(id, canvas.clientWidth, canvas.clientHeight) : null),
    lifted: () => tag.hide(),
  });

  // 瓶ごとの個体を描く（描いて動かすのは見えている瓶だけ）
  const showJars = (s: GameState): void => {
    app.setJars(s.jars, gameNow(s), s.specimens);
    tag.refresh();
  };
  showJars(game.state);
  game.onChange(showJars);

  // 夜のデスクライトのオン・オフ（初期はオン、保存される）。アイコンは夜の間だけ出す
  app.setLampOn(game.state.settings.lamp);
  const lampToggle = new LampToggle((on) => {
    app.setLampOn(on);
    game.updateSettings({ lamp: on });
    applyLight();
  }, game.state.settings.lamp);

  // 瓶を揺らす：端末の動き（DeviceMotion）。「揺れを使う」がオンで、許可があるときだけ受け取る。
  // iOS は許可が要る：瓶をつついた最初のタップと、設定で「使う」を入れ直したときに訊く。断られたら設定をオフにして、以後は訊かない
  const motion = new DeviceMotionSource();
  const debugMotion = new DebugMotion();
  /** 振ったことの検出。閾値を越えたときだけ、振った一回ぶんの勢いを水に与える（端末の傾きは使わない） */
  const shakes = new ShakeDetector();
  motion.setListening(game.state.settings.motion);
  const askMotion = (): void => {
    void motion.request().then((p) => {
      if (p === 'granted') motion.setListening(game.state.settings.motion);
      else if (p === 'denied' && game.state.settings.motion) game.updateSettings({ motion: false });
    });
  };
  const setMotion = (on: boolean): void => {
    game.updateSettings({ motion: on });
    if (on && motion.needsPermission) askMotion();
    else motion.setListening(on);
  };
  canvas.addEventListener('click', () => {
    if (game.state.settings.motion && motion.needsPermission && motion.state === 'unknown') askMotion();
  });
  /** 揺らしたことを sim に記録した時刻（瓶ごと、performance.now） */
  const stirReported = game.state.jars.map(() => -Infinity);
  /** 端末の動きを描画へ渡し、揺らされた瓶を sim に記録する（何度揺らしても、記録し直すのは間をあけて） */
  const applyMotion = (dt: number): void => {
    debugMotion.update(dt);
    // 読み込みやリセットで設定が変わっても合うように（許可がなければ受け取らない）
    motion.setListening(game.state.settings.motion);
    const sensor = game.state.settings.motion ? motion.sample(MOTION.staleSeconds) : null;
    const kick = shakes.push(debugMotion.apply(sensor), dt);
    if (kick) app.kick(kick);
    const now = performance.now();
    for (let j = 0; j < stirReported.length; j++) {
      if (!app.takeStirred(j) || now - stirReported[j]! < SLOSH.recordInterval * 1000) continue;
      stirReported[j] = now;
      game.stir(j);
    }
  };

  /**
   * 表示中の瓶に餌をやる（1瓶につき1日1回）。状態は押したときに変え（食べた量もここで決まる）、
   * スポイトが降りてきて水の中で餌を出し、粒が食べられていくのを見せる。やれたら true。force は確認用（1日1回を無視）
   */
  const feedNow = (force = false): boolean => {
    if (app.handsBusy || slider.moving || !app.atRest) return false;
    const j = slider.index;
    if (force) game.edit((s) => clearFed(s, j));
    if (game.canFeed(j) !== 'fed') return false;
    tag.hide();
    if (game.feed(j) !== 'fed') return false;
    const jar = game.state.jars[j]!;
    const at = lastMealAt(jar);
    if (at !== null) app.feedStart(j, at, feedingPlan(jar, at));
    return true;
  };
  const feedButton = new FeedButton(() => void feedNow());

  /** 読み込んだ状態に、ライトと見ている瓶を合わせる（日誌の設定とデバッグパネルから） */
  const afterImport = (): void => {
    applyQuality();
    sound.setEnabled(game.state.settings.sound);
    app.setLampOn(game.state.settings.lamp);
    lampToggle.set(game.state.settings.lamp);
    jumpToSavedJar();
    void applyRoom();
  };

  // おじさんの手紙。机の上の封筒（最初の手紙）はタップで読み、読んだら日誌のその日のページに留まる。
  // 留めた手紙は、日誌のページでタップすると少し大きく開く
  const reader = new LetterReader();
  /** 机の上にある封筒（まだ開いていない手紙） */
  const sealedLetter = (): Letter | null => game.state.letters.find((l) => l.sealed) ?? null;
  const envelope = new Envelope(() => {
    const l = sealedLetter();
    if (!l || reader.isOpen) return;
    tag.hide();
    reader.open(l, () => game.openLetter(l.id));
  });
  /** 封筒を天板の上に（虫眼鏡と同じく部屋の側。瓶を切り替えても動かない）。カップやスポイトを使っている間は出さない */
  const placeEnvelope = (): void => {
    const l = sealedLetter();
    const show = l !== null && !app.handsBusy && !reader.isOpen;
    envelope.place(show ? app.roomPoint(UNCLE.envelope[0], UNCLE.envelope[1], canvas.clientWidth, canvas.clientHeight) : null);
  };
  // 桜の季節（家の部屋だけ）：天板に花びらが一枚落ちている日がある。封筒と同じく部屋の側で、カップやスポイトを使っている間は出さない
  const petalView = new PetalView();
  /** 今日の花びら（光を合わせるときに日付から決め直す）と、確認用の季節の上書き（null なら日付どおり） */
  let petal: Petal | null = null;
  let sakuraOverride: boolean | null = null;
  const placePetal = (): void => {
    const show = petal !== null && ROOMS[app.roomName].sakura && !app.handsBusy;
    petalView.place(show ? app.roomPoint(petal!.x, petal!.z, canvas.clientWidth, canvas.clientHeight) : null, petal?.angle);
  };
  /** 日付から桜の季節と花びらを決める。確認用に季節にしたときは、花びらが見えるよう季節の中で花びらのある最初の日のものを置く */
  const applySeason = (): void => {
    const now = clock.now();
    const season = sakuraOverride ?? inSakuraSeason(now);
    app.setSakura(season);
    if (!season) petal = null;
    else if (sakuraOverride === null) petal = petalOf(now);
    else {
      const year = new Date(now).getFullYear();
      petal = null;
      for (let d = SAKURA.start[1]; !petal && d <= SAKURA.end[1]; d++) petal = petalOf(new Date(year, SAKURA.start[0] - 1, d, 12).getTime());
    }
  };

  /** おじさんへ送るかを確かめる札と、運んでいる間の「おじさんに送る」 */
  const sendConfirm = new SendConfirm();
  const sendHint = new SendHint();

  // 観察日誌（左下）。日誌に一行増えたら点が付き、開いたら消える
  const notebook = new Notebook({
    state: () => game.state,
    now: () => clock.now(),
    rename: (id, name) => game.rename(id, name),
    exportJson: () => game.exportJson(),
    importJson: (text) => {
      game.importJson(text);
      afterImport();
    },
    motion: () => game.state.settings.motion,
    setMotion,
    sound: () => game.state.settings.sound,
    setSound,
    playSound: (name) => sound.play(name),
    quality: () => game.state.settings.quality,
    setQuality,
    room: () => game.state.settings.room,
    setRoom,
    opened: () => {
      tag.hide();
      game.markJournalRead();
    },
    closed: () => game.markJournalRead(),
    readLetter: (id) => {
      const l = game.state.letters.find((x) => x.id === id);
      if (l) reader.open(l);
    },
    newFacts: () => game.newFacts,
    speciesShown: () => {
      game.noteFact('page');
      game.markFactsSeen();
    },
    photo: (id) => game.photo(id),
    removePhoto: (id) => game.removePhoto(id),
    sinkSpecimen: (id) => sinkSpecimen(id),
    raiseSpecimen: (id) => void game.raiseFind(id),
  });
  const journalButton = new JournalButton(() => notebook.open());
  const showJournal = (): void => {
    journalButton.setUnread(game.unread || game.newFacts);
    notebook.refresh();
  };
  showJournal();
  game.onChange(showJournal);
  /** 部屋の明るさに合わせた、日誌の紙の明るさ */
  const paperLum = (light: LightState): number =>
    NOTEBOOK.lumDay * light.day +
    NOTEBOOK.lumDusk * light.dusk +
    (app.lampIsOn && light.lamp > 0.5 ? NOTEBOOK.lumNight : NOTEBOOK.lumDark) * light.night;

  let hourOverride: number | null = null;
  let lightTimer = 0;
  const applyLight = (): void => {
    const now = new Date(clock.now());
    const sun = sunOf(now);
    const h = hourOverride ?? hourOf(now);
    const light = lightAt(h, sun);
    app.setLight(light);
    sound.setNight(light.night);
    lampToggle.setVisible(light.lamp > 0.5);
    const lum = paperLum(light);
    notebook.setLum(lum);
    reader.setLum(lum);
    loupe.setLum(lum);
    envelope.setLum(lum);
    petalView.setLum(lum);
    applySeason();
    sendConfirm.setLum(lum);
    panel?.showHour(h, sun.sunrise, sun.sunset);
  };

  /** 確認用の書き換え。デバッグパネルと撮影用の窓口（?debug&capture）で同じものを使う */
  const debugEdits = {
    /** 瓶 jar に個体を出す（育ちきった姿で。progress は段階の進み、spot は瓶底の場所）。番号を返す */
    spawn: (jar: number, stage: Stage, progress = 0, spot?: [number, number], species: Species = 'aurelia'): number => {
      let id = 0;
      game.edit((s, rules) => {
        const c = spawnCreature(s, jar, stage, rules, species);
        if (spot && c.spot) c.spot = spot;
        id = c.id;
        setProgress(s, id, progress);
      });
      return id;
    },
    setStage: (id: number, stage: Stage) => game.edit((s, rules) => setStage(s, id, stage, rules)),
    setProgress: (id: number, p: number) => game.edit((s) => setProgress(s, id, p)),
    setDiscs: (id: number, n: number) => game.edit((s, rules) => setDiscs(s, id, n, rules)),
    remove: (id: number) => game.edit((s, rules) => removeCreature(s, id, rules)),
    /** 瓶 jar の泳ぐ個体を成体 n 匹に */
    fill: (jar: number, n: number) => game.edit((s, rules) => fillAdults(s, jar, n, rules)),
    genes: (id: number, e: GeneEdit) => game.edit((s) => editGenes(s, id, e)),
    /** 雌雄：オス・メス・成熟前に切り替える、'mature'（成熟まで飛ばす）、'brood'（メスにプラヌラを抱えさせる） */
    sex: (id: number, e: SexEdit | 'mature' | 'brood') =>
      game.edit((s) => {
        if (e === 'mature') skipMaturity(s, id);
        else if (e === 'brood') broodNow(s, id);
        else editSex(s, id, e);
      }),
    /** 成体になってからの成長：'day'（1日ぶん進める）、'full'（育ちきらせる） */
    grow: (id: number, e: 'day' | 'full') => game.edit((s) => (e === 'day' ? growAdult(s, id, 86400) : growFull(s, id))),
    /** カブトクラゲ：成体 id に今すぐ卵を産ませる、瓶 jar の卵を今すぐ孵す */
    layEggs: (id: number) => game.edit((s, rules) => layEggsNow(s, id, rules)),
    hatch: (jar: number) => game.edit((s, rules) => hatchNow(s, jar, rules)),
    feedClear: () => game.edit((s) => clearFed(s, null)),
    sediment: (jar: number, value: number) => game.edit((s) => setSediment(s, jar, value)),
    replyNow: () => game.edit((s) => deliverReplyNow(s)),
    /** 新しい種（カブトクラゲ）を今すぐ届ける。届いた個体の番号（入る瓶がなく、空きを訊く手紙になったら null） */
    giftNow: (): number | null => {
      let id: number | null = null;
      game.edit((s, rules) => (id = deliverGiftNow(s, 'bolinopsis', rules)));
      return id;
    },
    firstLetter: (jar: number) => game.edit((s) => resetFirstLetter(s, jar)),
    /** 瓶 jar の瓶底に拾いものを出す（variant を決めなければ重みで選ぶ）。番号を返す */
    spawnFind: (jar: number, variant?: string): number => {
      let id = 0;
      game.edit((s) => (id = spawnFind(s, jar, variant)));
      return id;
    },
    /** 瓶 jar（null ならすべての瓶）の瓶底の物を消す */
    clearFinds: (jar: number | null) => game.edit((s) => clearFinds(s, jar)),
    clearSpecimens: () => game.edit((s) => clearSpecimens(s)),
    factsAll: (open: boolean) => game.edit((s) => (open ? openAllFacts(s, clock.now()) : closeAllFacts(s))),
  };

  const panel =
    debug && !capture
      ? new DebugPanel({
          onHour: (h) => {
            hourOverride = h;
            applyLight();
          },
          onPhoto: (only, overlay) => app.setPhotoDebug(only, overlay),
          onSakura: (on) => {
            sakuraOverride = on;
            applySeason();
          },
          onSpeed: (rate) => clock.setSpeed(rate),
          onJump: (ms) => {
            clock.jump(ms);
            game.resume();
            applyLight();
          },
          onClockReset: () => {
            clock.reset();
            game.resume();
            applyLight();
          },
          onReset: () => {
            game.reset();
            applyQuality();
            sound.setEnabled(game.state.settings.sound);
            app.setLampOn(game.state.settings.lamp);
            lampToggle.set(game.state.settings.lamp);
            jumpToSavedJar();
            void applyRoom();
          },
          onExport: () => game.exportJson(),
          onImport: (text) => {
            game.importJson(text);
            afterImport();
          },
          onSpawn: (stage, species) => void debugEdits.spawn(slider.index, stage, 0, undefined, species),
          onStage: debugEdits.setStage,
          onProgress: debugEdits.setProgress,
          onDiscs: debugEdits.setDiscs,
          onRemove: debugEdits.remove,
          onFill: (n) => debugEdits.fill(slider.index, n),
          onGenes: debugEdits.genes,
          onSex: debugEdits.sex,
          onGrow: debugEdits.grow,
          onLayEggs: debugEdits.layEggs,
          onHatch: () => debugEdits.hatch(slider.index),
          onCap: (n) => game.setRules({ maxSwimmers: n }),
          onRealSize: (on) => setRealSize(on),
          onFeed: () => void feedNow(true),
          onFeedClear: debugEdits.feedClear,
          onMealsClear: () => game.edit((s) => clearMeals(s)),
          onSediment: (v) => debugEdits.sediment(slider.index, v),
          onUnread: () => game.edit((s) => (s.journalSeen = 0)),
          onShake: (kind) => debugMotion.start(kind),
          onFlip: () => app.flipForDebug(),
          onFirstLetter: () => debugEdits.firstLetter(slider.index),
          onReplyNow: debugEdits.replyNow,
          onGiftNow: () => void debugEdits.giftNow(),
          onFindSpawn: (variant) => void debugEdits.spawnFind(slider.index, variant ?? undefined),
          onFindsClear: () => debugEdits.clearFinds(slider.index),
          onSpecimensClear: debugEdits.clearSpecimens,
          onFactsAll: debugEdits.factsAll,
          onDummyPhoto: () => addDummyPhoto(),
          onSound: (name, opts) => sound.preview(name, opts),
          onAirBoost: (boost) => sound.previewAir(boost),
          onLoupeZoom: (z) => (loupe.zoom = z),
          onLoupeHome: () => loupe.returnToTable(),
        })
      : null;
  /** 確認用：表示中の瓶の餌の様子 */
  const feedText = (): string => {
    const j = slider.index;
    const jar = game.state.jars[j]!;
    const r = game.canFeed(j);
    const can = r === 'fed' ? 'やれる' : r === 'already' ? '今日はやった' : '食べる個体がいない';
    const last = jar.fedWallTime ? new Date(jar.fedWallTime).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'まだ';
    const f = app.feedingState;
    const g = f.grains;
    const show = f.active && f.jar === j ? `　${f.phase}・漂う${g.free}・食べ中${g.held + g.carry + g.absorb}・底${g.floor}` : '';
    const care = `　瓶底 ${jar.sediment.toFixed(2)}${jar.leftover ? '（食べ残しあり）' : ''}`;
    return `瓶${j + 1}：${can}（最後 ${last}）${show}${care}`;
  };
  /** 確認用：ポリプ・ストロビラ・エフィラを実物大で描く（すべての瓶） */
  const setRealSize = (on: boolean): void => {
    for (const c of app.jars) c.setRealSize(on);
    showJars(game.state);
  };
  /** 確認用：センサーと、表示中の瓶の水の様子 */
  const motionText = (): string => {
    const w = app.waterState;
    const sensor = !game.state.settings.motion
      ? '揺れを使わない'
      : motion.isListening
        ? `センサー受信中（符号 ${motion.accelSign}）`
        : motion.supported
          ? `許可 ${motion.state}`
          : 'センサーなし';
    const s = game.state;
    const until = s.jars[slider.index]!.stirredUntil;
    const left = until !== null ? until - gameNow(s) : 0;
    const sim = left > 0 ? `水が動いている 残り${Math.ceil(left / 60)}分` : '水は静か';
    // 今の値（少し前までのいちばん大きかった値）と閾値。閾値を越えたときだけ、振った一回になる
    const k = shakes.last;
    const last = k ? `最後に振った ${shakes.sinceLast < 60 ? `${Math.floor(shakes.sinceLast)}秒前` : '1分以上前'}・${k.spin ? '回した' : '振った'}・勢い ${k.size.toFixed(2)}` : 'まだ振っていない';
    const now = `加速度 ${shakes.accel.toFixed(2)}g（最大 ${shakes.accelPeak.toFixed(2)}）／閾値 ${KICK.accel}g　回転 ${shakes.spin.toFixed(1)}（最大 ${shakes.spinPeak.toFixed(1)}）／閾値 ${KICK.spin}`;
    const water = `流れ ${w.stir.toFixed(2)}・水面 ${w.tiltDeg.toFixed(1)}°・縁 ${w.rim.toFixed(2)}${w.splash ? '・飛沫' : ''}${w.dust > 0 ? `・舞う ${w.dust.toFixed(2)}` : ''}${w.righting ? `・起き直り中 ${w.righting}` : ''}`;
    return `${sensor}\n${now}\n${last}\n${water}　${sim}`;
  };
  if (panel) {
    refreshPanel = (): void => {
      panel.showState(game.state, game.info, clock.speed, clock.drift);
      panel.showCreatures(game.state.jars[slider.index]!, game.lifeRules.maxSwimmers, gameNow(game.state));
      panel.showFeed(feedText());
      panel.showUncle(game.state);
      panel.showFinds(game.state);
      panel.showBook(game.state);
    };
    game.onChange(refreshPanel);
    refreshPanel();
  }
  applyLight();

  // 瓶への指の操作：タップ（札、つつく）、横のスワイプ（瓶の切り替え）、長押し（つまんで隣の瓶へ運ぶ）
  const toNdc = (p: Point): [number, number] => [(p.x / canvas.clientWidth) * 2 - 1, 1 - (p.y / canvas.clientHeight) * 2];
  /** 指で押せる大きさ（ndc、画面の高さの半分を 1 とした半径） */
  const fingerNdc = (): number => HANDLING.pickRadiusPx / (canvas.clientHeight / 2);
  const carry = new Carry(app, game, slider, toNdc, () => canvas.clientWidth, sendConfirm, () =>
    app.boxAnchor(canvas.clientWidth, canvas.clientHeight),
  );
  /**
   * 瓶底の拾いもの id を拾う：初めてなら写真を撮り、物は薄れて消え、小さな光になって日誌のアイコンへ吸い込まれる。
   * 状態はここで変える（標本に移る）。日誌には書かない
   */
  const pickUpFind = (id: number): void => {
    const s = game.state.specimens.find((x) => x.id === id);
    if (!s?.at) return;
    tag.hide();
    const at = app.findScreen(id, canvas.clientWidth, canvas.clientHeight);
    const photo = s.photo ? null : app.photoFind(id);
    if (!game.pickFind(id, photo)) return;
    if (at) flyLight(at, journalButton.center(), () => journalButton.glow());
  };
  /** 撮ったとき：画面がふっと白くなる */
  const flash = (): void => {
    const el = document.createElement('div');
    el.className = 'shutter';
    el.style.setProperty('--a', String(BOOK.flashAlpha));
    el.style.setProperty('--s', `${BOOK.flashSeconds}s`);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('done'));
    setTimeout(() => el.remove(), BOOK.flashSeconds * 1000 + 200);
  };
  /**
   * 札の「撮る」：その個体を真ん中に一枚撮って種のページに貼る。虫眼鏡の「よく見る」で追っている間は、レンズの中身を一枚に。
   * 貼ったら光が日誌のアイコンへ。6枚で埋まっていたら、メモ帳を開いて入れ替える写真を選ばせる（やめてもよい）
   */
  const shoot = (id: number): void => {
    const c = game.state.jars[slider.index]?.creatures.find((x) => x.id === id);
    if (!c) return;
    const l = loupe.state;
    const url = l.mode === 'follow' && l.watching === id && loupe.lens ? app.photoLens() : app.photoCreature(id);
    if (!url) return;
    flash();
    const meta = { creature: id, name: c.name, wallTime: clock.now() };
    if (game.addPhoto(c.species, url, meta) === 'added') {
      const at = app.noteAnchor(id, canvas.clientWidth, canvas.clientHeight);
      if (at) flyLight(at, journalButton.center(), () => journalButton.glow());
      return;
    }
    notebook.openReplace(url, (oldId) => {
      if (oldId !== null) game.replacePhoto(oldId, url, meta);
    });
  };

  /** 確認用：ダミーの写真を1枚貼る（6枚なら、撮ったときと同じく入れ替える写真を選ぶ） */
  const addDummyPhoto = (): void => {
    const n = 160;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const hue = Math.floor(Math.random() * 360);
    const g = ctx.createLinearGradient(0, 0, n, n);
    g.addColorStop(0, `hsl(${hue} 30% 25%)`);
    g.addColorStop(1, `hsl(${(hue + 60) % 360} 30% 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '20px serif';
    ctx.fillText('ダミー', 46, 88);
    const url = cv.toDataURL('image/jpeg', 0.8);
    const meta = { creature: null, name: null, wallTime: clock.now() };
    if (game.addPhoto('aurelia', url, meta) === 'added') return;
    notebook.openReplace(url, (oldId) => {
      if (oldId !== null) game.replacePhoto(oldId, url, meta);
    });
  };

  /** 泳ぐ個体の上なら札、瓶底の拾いものの上なら拾う、ポリプの上なら札、瓶の空いたところならガラスをつつく */
  const tapAt = (p: Point): void => {
    const [x, y] = toNdc(p);
    const swimmer = app.pickAt(x, y, fingerNdc(), true);
    if (swimmer !== null) {
      tag.show(swimmer);
      return;
    }
    const find = app.handsBusy ? null : app.pickFind(x, y, fingerNdc());
    if (find !== null) {
      pickUpFind(find);
      return;
    }
    const id = app.pickAt(x, y, fingerNdc());
    if (id !== null) tag.show(id);
    // 初めて瓶をつついたとき（の豆知識）
    else if (app.poke(x, y)) game.noteFact('poke');
  };

  /**
   * 標本の物を、見ている瓶に沈める。メモ帳を下げてから、水面からそっと入って沈んでいくところを瓶の前で見せる
   * （場所は空いた所を選ぶ。その瓶に前に沈めた物は黙って標本へ戻る）。沈められなければ false
   */
  const sinkSpecimen = (id: number): boolean => {
    if (app.handsBusy || slider.moving || !app.atRest) return false;
    const j = slider.index;
    if (game.canPlaceFind(id, j) !== 'placed') return false;
    notebook.close();
    window.setTimeout(() => {
      if (game.canPlaceFind(id, j) !== 'placed') return;
      app.dropFind(j, id);
      game.placeFind(id, j);
    }, FIND_LOOK.sinkDelayMs);
    return true;
  };
  /** 長押しでつまめる個体（指を置いたときに、その下にいた泳ぐ個体） */
  let holdable: number | null = null;
  new Gestures(canvas, {
    press: (p) => {
      if (slider.moving) return 'swipe';
      slider.finish();
      app.setView(slider.position);
      const [x, y] = toNdc(p);
      // カップやスポイトを使っている間は、新しく運ばない
      holdable = app.handsBusy ? null : app.pickAt(x, y, fingerNdc(), true);
      return holdable !== null ? 'holdable' : 'plain';
    },
    tap: tapAt,
    swipeStart: () => {
      tag.hide();
      // 瓶を切り替えるときは、虫眼鏡を天板へ戻す
      loupe.returnToTable();
      slider.grab();
    },
    swipeMove: (dx) => slider.drag(dx),
    swipeEnd: (v) => slider.release(v),
    holdStart: (p) => {
      if (holdable === null) return false;
      tag.hide();
      return carry.start(holdable, p);
    },
    holdMove: (p) => carry.move(p),
    holdEnd: () => carry.end(),
  });

  /** 1フレーム：瓶の並びを動かし、描き、点と札を合わせる（draw が false なら描かずに動きだけ） */
  /** 豆知識のきっかけ（画面の出来事）を確かめる間隔の残り（秒） */
  let factTimer = 0;
  /**
   * 画面の出来事の豆知識：逆さまになった・起き直った（毎フレーム数える）、虫眼鏡を瓶に当てた・エフィラに当てた、プラヌラを抱えた個体を見た（ときどき確かめる）
   */
  const checkScreenFacts = (dt: number): void => {
    const r = app.takeRighting();
    if (r.flips > 0) game.noteFact('flip');
    for (let i = 0; i < r.righted; i++) game.countRighted();
    factTimer -= dt;
    if (factTimer > 0) return;
    factTimer = 0.5;
    // 見ている瓶に、プラヌラを抱えている個体がいる（粒が見えている）
    if (app.atRest) {
      const t = gameNow(game.state);
      if (game.state.jars[slider.index]?.creatures.some((c) => broodAmount(c, t) >= BOOK.planulaSeen)) game.noteFact('planula');
    }
    const lens = loupe.lens;
    if (!loupe.inUse || !lens || lens.alpha < 0.9 || !app.atRest) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const b = app.jarBounds(w, h);
    if (lens.x > b.left && lens.x < b.right && lens.y > b.top && lens.y < b.bottom) game.noteFact('loupe');
    for (const c of game.state.jars[slider.index]?.creatures ?? []) {
      if (c.stage !== 'ephyra') continue;
      const a = app.noteAnchor(c.id, w, h);
      if (a && Math.hypot(a.x - lens.x, a.y - lens.y) < lens.radius) game.noteFact('loupeEphyra');
    }
  };

  const tick = (dt: number, draw = true): void => {
    applyMotion(dt);
    slider.update(dt);
    app.setView(slider.position);
    // 虫眼鏡：瓶を切り替えている間（運んで隣へ移るときも）は天板へ戻す。カップやスポイトを使っている間は、天板の虫眼鏡を出さない
    if (!app.atRest && loupe.inUse) loupe.returnToTable();
    loupe.setHidden(app.handsBusy);
    loupe.update(dt);
    app.setLoupe(loupe.lens);
    if (draw) app.frame(dt);
    else app.simulate(dt);
    checkScreenFacts(dt);
    dots.set(slider.position);
    tag.update(dt);
    placeEnvelope();
    placePetal();
    sendHint.set(app.scoopCarrying && carry.canSend && !carry.atBox);
    feedButton.setBusy(app.feedingBusy);
    feedButton.setReady(game.canFeed(slider.index) === 'fed');
  };

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  if (capture) {
    const w = window as unknown as Record<string, unknown>;
    const edit = (fn: Parameters<typeof game.edit>[0]): void => game.edit(fn);
    w.__kurage = {
      frame: (dt: number) => tick(dt),
      simulate: (seconds: number) => {
        for (let t = 0; t < seconds; t += 1 / 60) app.simulate(1 / 60);
      },
      // 瓶の並び・札も含めて seconds 秒ぶん動かし、最後に1回だけ描く（指の操作の途中を撮る）
      play: (seconds: number) => {
        for (let t = 0; t < seconds; t += 1 / 60) tick(1 / 60, false);
        tick(0);
      },
      jelly: () => app.jellyScreenPosition(canvas.clientWidth, canvas.clientHeight),
      // 個体を出す・変える（見た目の確認用）。spawn は番号を返す
      spawn: (stage: Stage, progress = 0, spot?: [number, number], species: Species = 'aurelia') => debugEdits.spawn(slider.index, stage, progress, spot, species),
      spawnIn: (jar: number, stage: Stage, progress = 0) => debugEdits.spawn(jar, stage, progress),
      fillIn: debugEdits.fill,
      // 瓶の並びの上の位置（0 が1番の瓶。スワイプの途中は小数）で止める。settle() で近いほうの瓶へ落ち着く
      view: (v: number) => {
        slider.pin(v);
        app.setView(slider.position);
      },
      settle: () => slider.release(0),
      jarIndex: () => slider.index,
      setStage: debugEdits.setStage,
      // 遺伝子：'base'（基準）・'generations'（6世代ばらす）・{ set: { hue: 1, leaves: 5, ... } }
      genes: debugEdits.genes,
      // 雌雄：'male' | 'female' | 'immature'（デバッグパネルと同じ）、'mature'（成熟まで飛ばす）、'brood'（メスにプラヌラを抱えさせる）
      sex: debugEdits.sex,
      // 成体になってからの成長：'day'（1日ぶん進める）、'full'（育ちきらせる）
      grow: debugEdits.grow,
      // カブトクラゲ：卵を産ませる（成体の番号）、表示中の瓶の卵を孵す
      layEggs: debugEdits.layEggs,
      hatch: () => debugEdits.hatch(slider.index),
      setProgress: debugEdits.setProgress,
      setDiscs: debugEdits.setDiscs,
      remove: debugEdits.remove,
      fill: (n: number) => debugEdits.fill(slider.index, n),
      clear: () => edit((s) => (s.jars[slider.index]!.creatures = [])),
      edit: (fn: (s: GameState) => void) => edit(fn),
      state: () => game.state,
      advance: (seconds: number) => {
        clock.jump(seconds * 1000);
        game.resume();
      },
      // 個体の画面上の位置（CSS px）
      where: (id: number) => {
        const p = app.creatures.positionForDebug(id);
        if (!p) return null;
        p.project(app.camera);
        return [((p.x + 1) / 2) * canvas.clientWidth, ((1 - p.y) / 2) * canvas.clientHeight];
      },
      place: (id: number, pos: [number, number, number], up: [number, number, number] = [0, 1, 0], yaw = 0) =>
        app.creatures.placeForDebug(id, new Vector3(...pos), new Vector3(...up), yaw),
      realSize: (on: boolean) => setRealSize(on),
      // 画面の上の位置（CSS px）をタップしたのと同じ（札、つつく）
      tap: (x: number, y: number) => tapAt({ x, y }),
      tagged: () => tag.shownId,
      // 餌：アイコンを押したのと同じ（force は1日1回を無視）。feeding() は流れの段階と粒の数
      feed: (force = false) => feedNow(force),
      feeding: () => app.feedingState,
      feedClear: debugEdits.feedClear,
      // 瓶底の堆積（瓶 jar を value に）と、日誌を開く・閉じる
      sediment: debugEdits.sediment,
      journal: (open: boolean) => (open ? notebook.open() : notebook.close()),
      setHour: (h: number) => {
        hourOverride = h;
        applyLight();
      },
      // 桜の季節の上書き（null なら日付どおり）と、今の花びら
      sakura: (on: boolean | null) => {
        sakuraOverride = on;
        applySeason();
      },
      petal: () => petal,
      setPhoto: (only: Parameters<App['setPhotoDebug']>[0], overlay: Parameters<App['setPhotoDebug']>[1]) =>
        app.setPhotoDebug(only, overlay),
      setLamp: (on: boolean) => app.setLampOn(on),
      // 揺れ：一回揺らす（'weak' | 'medium' | 'strong'。弱は閾値を越えない）、逆さまにして起き直るところを見る、水の様子
      shake: (kind: 'weak' | 'medium' | 'strong') => debugMotion.start(kind),
      flip: () => app.flipForDebug(),
      water: () => app.waterState,
      motionText: () => motionText(),
      // おじさん：状態だけで送る（カップの流れなし）、返事を今すぐ届ける、最初の手紙を出し直す
      send: (id: number) => game.send(id),
      replyNow: debugEdits.replyNow,
      giftNow: debugEdits.giftNow,
      firstLetter: () => debugEdits.firstLetter(slider.index),
      // 拾いもの：表示中の瓶に出す（variant を決めなければ重みで選ぶ。番号を返す）、瓶底の物の画面上の位置、拾う（タップと同じ）、
      // 標本から見ている瓶に沈める（メモ帳を下げてから。沈められたら true）、瓶底の物を消す、標本を空に
      spawnFind: (variant?: string) => debugEdits.spawnFind(slider.index, variant),
      findWhere: (id: number) => app.findScreen(id, canvas.clientWidth, canvas.clientHeight),
      pickFind: (id: number) => pickUpFind(id),
      sinkFind: (id: number) => sinkSpecimen(id),
      clearFinds: () => debugEdits.clearFinds(null),
      clearSpecimens: debugEdits.clearSpecimens,
      // 種のページ：札の「撮る」と同じ、ダミーの写真、豆知識をすべて開く・閉じる、豆知識のきっかけ（画面の出来事）
      shoot: (id: number) => shoot(id),
      dummyPhoto: () => addDummyPhoto(),
      factsAll: debugEdits.factsAll,
      noteFact: (key: Parameters<typeof game.noteFact>[0]) => game.noteFact(key),
      // 音：設定によらず鳴らす（確認用）、オン・オフ、空気の音を大きくして聞く
      sound: (name: SoundName, opts?: SoundOptions) => sound.preview(name, opts),
      setSound: (on: boolean) => setSound(on),
      airBoost: (boost: number) => sound.previewAir(boost),
      // 音を書き出して、大きさ（いちばん大きい所と平均）・長さ（-50dB を越えている最後の時刻）・いちばん強い高さ（Hz）を返す
      soundStats: async (name: SoundName, opts?: SoundOptions) => {
        const d = await Sound.renderOffline(name, opts);
        let peak = 0;
        let sum = 0;
        let last = 0;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]!);
          peak = Math.max(peak, a);
          sum += a * a;
          if (a > 0.00316) last = i;
        }
        // 素朴な DFT で 100〜6000Hz のいちばん強い高さ（はじめの 0.2 秒）
        const n = 8820;
        let best = 0;
        let bestP = 0;
        for (let f = 100; f <= 6000; f += 10) {
          let re = 0;
          let im = 0;
          for (let i = 0; i < n; i++) {
            const w = (2 * Math.PI * f * i) / 44100;
            re += d[i]! * Math.cos(w);
            im += d[i]! * Math.sin(w);
          }
          const p = re * re + im * im;
          if (p > bestP) {
            bestP = p;
            best = f;
          }
        }
        return { peak, rms: Math.sqrt(sum / d.length), seconds: last / 44100, freq: best };
      },
      // 虫眼鏡：今の様子、「よく見る」、倍率、天板へ戻す、画質「低」（引き伸ばし）、レンズの中を画像に（一辺 px）
      loupe: () => loupe.state,
      look: (id: number) => loupe.lookAt(id),
      zoom: (z: number) => (loupe.zoom = z),
      loupeHome: () => loupe.returnToTable(),
      lowQuality: (on: boolean) => setQuality(on ? 'low' : 'high'),
      quality: (q: Settings['quality']) => setQuality(q),
      /** 部屋：設定で選ぶのと同じ（写真を読み込み終わるまで待つ） */
      room: async (r: RoomName) => {
        setRoom(r);
        await applyRoom();
      },
      lensImage: (px = 256) => {
        const img = app.captureLens(px);
        if (!img) return null;
        let sum = 0;
        for (let i = 0; i < img.data.length; i += 4) sum += img.data[i + 3]!;
        return { w: img.width, h: img.height, alpha: sum / (img.width * img.height * 255) };
      },
    };
    // 確認用：描画側の中身を直接見る
    w.__kurageApp = app;
    w.__kurageNotebook = notebook;
    w.__kurageReady = true;
    return;
  }

  let raf = 0;
  let last = performance.now();
  const loop = (now: number): void => {
    // 画質の 1秒に描く回数まで（低は 30fps）。間の画面の更新は飛ばす
    if (!shouldDraw(now, last, QUALITY[game.state.settings.quality].fps)) {
      raf = requestAnimationFrame(loop);
      return;
    }
    const dt = (now - last) / 1000;
    last = now;
    lightTimer += dt;
    // 1秒ごとに（早送り中は毎フレーム）：時計に合わせてゲームの時間を進め（間隔が空いたら保存）、光を合わせる。
    // 画面の大きさが知らせなしに変わっていることがあるので、ついでに確かめる
    if (lightTimer > (clock.speed > 1 ? 0 : 1)) {
      lightTimer = 0;
      // 見ている瓶の出来事は日誌に書かない（ほかの瓶の出来事は書く）
      game.tick(slider.index);
      applyLight();
      layout(canvas, app);
    }
    tick(dt);
    panel?.tick(dt);
    panel?.showMotion(motionText());
    raf = requestAnimationFrame(loop);
  };
  const start = (): void => {
    cancelAnimationFrame(raf);
    last = performance.now();
    applyLight();
    raf = requestAnimationFrame(loop);
  };
  // タブが見えていない間は描画を止める。離れる直前に保存し、戻ったら閉じていた分を進める
  document.addEventListener('visibilitychange', () => {
    sound.setHidden(document.hidden);
    if (document.hidden) {
      cancelAnimationFrame(raf);
      void game.save();
    } else {
      game.resume();
      start();
    }
  });
  window.addEventListener('pagehide', () => void game.save());
  start();
  registerServiceWorker(import.meta.env.BASE_URL, () => game.save());
}

void main();
