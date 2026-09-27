import './style.css';
import { Vector3 } from 'three';
import { HANDLING, NOTEBOOK, SIM } from './config';
import { DebugPanel } from './debug/panel';
import { Game } from './game';
import { App } from './render/app';
import { hourOf, lightAt, sunOf, type LightState } from './render/lighting';
import { Clock } from './sim/clock';
import { clearFed, clearMeals, fillAdults, removeCreature, setDiscs, setProgress, setSediment, setStage, spawnCreature } from './sim/edit';
import { feedingPlan, lastMealAt } from './sim/feed';
import type { GameState, Stage } from './sim/state';
import { Carry } from './ui/carry';
import { JarDots } from './ui/dots';
import { FeedButton } from './ui/feedButton';
import { Gestures, type Point } from './ui/gestures';
import { JournalButton } from './ui/journal/button';
import { Notebook } from './ui/journal/notebook';
import { JarSlider } from './ui/jarSlider';
import { LampToggle } from './ui/lampToggle';
import { CreatureTag } from './ui/tag';
import { registerServiceWorker } from './pwa/register';

const params = new URLSearchParams(location.search);
// ?debug のほか、クエリを渡せない環境のために #debug でも開ける
const debug = params.has('debug') || location.hash === '#debug';
/** 確認用（?debug のときだけ）：自動では進めず、外から1コマずつ進める */
const capture = debug && params.has('capture');

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
  const key = `${vw}x${vh}@${dpr}`;
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
    if (maxDpr > 0) app.maxDpr = maxDpr;
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
  const [game] = await Promise.all([gameReady, app.load(import.meta.env.BASE_URL)]);

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
      return { name: c.name, stage: c.stage, day: Math.floor(Math.max(0, s.time - c.arrivedAt) / 86400) + 1 };
    },
    anchor: (id) => app.noteAnchor(id, canvas.clientWidth, canvas.clientHeight),
    rename: (id, name) => game.rename(id, name),
  });

  // 瓶ごとの個体を描く（描いて動かすのは見えている瓶だけ）
  const showJars = (s: GameState): void => {
    app.setJars(s.jars, s.time + s.pending);
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
    app.setLampOn(game.state.settings.lamp);
    lampToggle.set(game.state.settings.lamp);
    jumpToSavedJar();
  };

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
    opened: () => {
      tag.hide();
      game.markJournalRead();
    },
    closed: () => game.markJournalRead(),
  });
  const journalButton = new JournalButton(() => notebook.open());
  const showJournal = (): void => {
    journalButton.setUnread(game.unread);
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
    lampToggle.setVisible(light.lamp > 0.5);
    notebook.setLum(paperLum(light));
    panel?.showHour(h, sun.sunrise, sun.sunset);
  };

  const panel =
    debug && !capture
      ? new DebugPanel({
          onHour: (h) => {
            hourOverride = h;
            applyLight();
          },
          onPhoto: (only, overlay) => app.setPhotoDebug(only, overlay),
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
            app.setLampOn(game.state.settings.lamp);
            lampToggle.set(game.state.settings.lamp);
            jumpToSavedJar();
          },
          onExport: () => game.exportJson(),
          onImport: (text) => {
            game.importJson(text);
            afterImport();
          },
          onSpawn: (stage) => game.edit((s, rules) => void spawnCreature(s, slider.index, stage, rules)),
          onStage: (id, stage) => game.edit((s, rules) => setStage(s, id, stage, rules)),
          onProgress: (id, p) => game.edit((s) => setProgress(s, id, p)),
          onDiscs: (id, n) => game.edit((s, rules) => setDiscs(s, id, n, rules)),
          onRemove: (id) => game.edit((s, rules) => removeCreature(s, id, rules)),
          onFill: (n) => game.edit((s, rules) => fillAdults(s, slider.index, n, rules)),
          onCap: (n) => game.setRules({ maxSwimmers: n }),
          onRealSize: (on) => setRealSize(on),
          onFeed: () => void feedNow(true),
          onFeedClear: () => game.edit((s) => clearFed(s, null)),
          onMealsClear: () => game.edit((s) => clearMeals(s)),
          onSediment: (v) => game.edit((s) => setSediment(s, slider.index, v)),
          onUnread: () => game.edit((s) => (s.journalSeen = 0)),
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
  if (panel) {
    refreshPanel = (): void => {
      panel.showState(game.state, game.info, clock.speed, clock.drift);
      panel.showCreatures(game.state.jars[slider.index]!, game.lifeRules.maxSwimmers);
      panel.showFeed(feedText());
    };
    game.onChange(refreshPanel);
    refreshPanel();
  }
  applyLight();

  // 瓶への指の操作：タップ（札、つつく）、横のスワイプ（瓶の切り替え）、長押し（つまんで隣の瓶へ運ぶ）
  const toNdc = (p: Point): [number, number] => [(p.x / canvas.clientWidth) * 2 - 1, 1 - (p.y / canvas.clientHeight) * 2];
  /** 指で押せる大きさ（ndc、画面の高さの半分を 1 とした半径） */
  const fingerNdc = (): number => HANDLING.pickRadiusPx / (canvas.clientHeight / 2);
  const carry = new Carry(app, game, slider, toNdc, () => canvas.clientWidth);
  /** 海月やポリプの上なら札を出し、瓶の空いたところならガラスをつつく */
  const tapAt = (p: Point): void => {
    const [x, y] = toNdc(p);
    const id = app.pickAt(x, y, fingerNdc());
    if (id !== null) tag.show(id);
    else app.poke(x, y);
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
  const tick = (dt: number, draw = true): void => {
    slider.update(dt);
    app.setView(slider.position);
    if (draw) app.frame(dt);
    else app.simulate(dt);
    dots.set(slider.position);
    tag.update(dt);
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
      spawn: (stage: Stage, progress = 0, spot?: [number, number]) => {
        let id = 0;
        edit((s, rules) => {
          const c = spawnCreature(s, slider.index, stage, rules);
          if (spot && c.spot) c.spot = spot;
          id = c.id;
          setProgress(s, id, progress);
        });
        return id;
      },
      spawnIn: (jar: number, stage: Stage, progress = 0) => {
        let id = 0;
        edit((s, rules) => {
          id = spawnCreature(s, jar, stage, rules).id;
          setProgress(s, id, progress);
        });
        return id;
      },
      fillIn: (jar: number, n: number) => edit((s, rules) => fillAdults(s, jar, n, rules)),
      // 瓶の並びの上の位置（0 が1番の瓶。スワイプの途中は小数）で止める。settle() で近いほうの瓶へ落ち着く
      view: (v: number) => {
        slider.pin(v);
        app.setView(slider.position);
      },
      settle: () => slider.release(0),
      jarIndex: () => slider.index,
      setStage: (id: number, stage: Stage) => edit((s, rules) => setStage(s, id, stage, rules)),
      setProgress: (id: number, p: number) => edit((s) => setProgress(s, id, p)),
      setDiscs: (id: number, n: number) => edit((s, rules) => setDiscs(s, id, n, rules)),
      remove: (id: number) => edit((s, rules) => removeCreature(s, id, rules)),
      fill: (n: number) => edit((s, rules) => fillAdults(s, slider.index, n, rules)),
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
      place: (id: number, pos: [number, number, number], up: [number, number, number] = [0, 1, 0]) =>
        app.creatures.placeForDebug(id, new Vector3(...pos), new Vector3(...up)),
      realSize: (on: boolean) => setRealSize(on),
      // 画面の上の位置（CSS px）をタップしたのと同じ（札、つつく）
      tap: (x: number, y: number) => tapAt({ x, y }),
      tagged: () => tag.shownId,
      // 餌：アイコンを押したのと同じ（force は1日1回を無視）。feeding() は流れの段階と粒の数
      feed: (force = false) => feedNow(force),
      feeding: () => app.feedingState,
      feedClear: () => edit((s) => clearFed(s, null)),
      // 瓶底の堆積（瓶 jar を value に）と、日誌を開く・閉じる
      sediment: (jar: number, value: number) => edit((s) => setSediment(s, jar, value)),
      journal: (open: boolean) => (open ? notebook.open() : notebook.close()),
      setHour: (h: number) => {
        hourOverride = h;
        applyLight();
      },
      setPhoto: (only: Parameters<App['setPhotoDebug']>[0], overlay: Parameters<App['setPhotoDebug']>[1]) =>
        app.setPhotoDebug(only, overlay),
      setLamp: (on: boolean) => app.setLampOn(on),
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
  registerServiceWorker(import.meta.env.BASE_URL);
}

void main();
