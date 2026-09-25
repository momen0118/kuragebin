import './style.css';
import { Vector3 } from 'three';
import { DebugPanel } from './debug/panel';
import { Game } from './game';
import { App } from './render/app';
import { hourOf, lightAt, sunOf } from './render/lighting';
import { Clock } from './sim/clock';
import { fillAdults, removeCreature, setDiscs, setProgress, setStage, spawnCreature } from './sim/edit';
import type { GameState, Stage } from './sim/state';
import { LampToggle } from './ui/lampToggle';
import { onTap } from './ui/tap';
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

  // 表示中の瓶の個体を描く（瓶の切り替えは 3-2）
  const shownJar = 0;
  const showJar = (s: GameState): void => app.setJar(s.jars[shownJar]!);
  showJar(game.state);
  game.onChange(showJar);

  // 夜のデスクライトのオン・オフ（初期はオン、保存される）。アイコンは夜の間だけ出す
  app.setLampOn(game.state.settings.lamp);
  const lampToggle = new LampToggle((on) => {
    app.setLampOn(on);
    game.updateSettings({ lamp: on });
  }, game.state.settings.lamp);

  let hourOverride: number | null = null;
  let lightTimer = 0;
  const applyLight = (): void => {
    const now = new Date(clock.now());
    const sun = sunOf(now);
    const h = hourOverride ?? hourOf(now);
    const light = lightAt(h, sun);
    app.setLight(light);
    lampToggle.setVisible(light.lamp > 0.5);
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
          },
          onExport: () => game.exportJson(),
          onImport: (text) => {
            game.importJson(text);
            app.setLampOn(game.state.settings.lamp);
            lampToggle.set(game.state.settings.lamp);
          },
          onSpawn: (stage) => game.edit((s, rules) => void spawnCreature(s, shownJar, stage, rules)),
          onStage: (id, stage) => game.edit((s, rules) => setStage(s, id, stage, rules)),
          onProgress: (id, p) => game.edit((s) => setProgress(s, id, p)),
          onDiscs: (id, n) => game.edit((s, rules) => setDiscs(s, id, n, rules)),
          onRemove: (id) => game.edit((s, rules) => removeCreature(s, id, rules)),
          onFill: (n) => game.edit((s, rules) => fillAdults(s, shownJar, n, rules)),
          onCap: (n) => game.setRules({ maxSwimmers: n }),
          onRealSize: (on) => {
            app.creatures.setRealSize(on);
            showJar(game.state);
          },
        })
      : null;
  if (panel) {
    const show = (): void => {
      panel.showState(game.state, game.info, clock.speed, clock.drift);
      panel.showCreatures(game.state.jars[shownJar]!, game.lifeRules.maxSwimmers);
    };
    game.onChange(show);
    show();
  }
  applyLight();

  // 瓶をつつく（海月の上のタップは、フェーズ3で札を出すために空けておく）
  onTap(canvas, (x, y) => {
    app.tap(x, y);
  });

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  if (capture) {
    const w = window as unknown as Record<string, unknown>;
    const edit = (fn: Parameters<typeof game.edit>[0]): void => game.edit(fn);
    w.__kurage = {
      frame: (dt: number) => app.frame(dt),
      simulate: (seconds: number) => {
        for (let t = 0; t < seconds; t += 1 / 60) app.simulate(1 / 60);
      },
      jelly: () => app.jellyScreenPosition(canvas.clientWidth, canvas.clientHeight),
      // 個体を出す・変える（見た目の確認用）。spawn は番号を返す
      spawn: (stage: Stage, progress = 0, spot?: [number, number]) => {
        let id = 0;
        edit((s, rules) => {
          const c = spawnCreature(s, shownJar, stage, rules);
          if (spot && c.spot) c.spot = spot;
          id = c.id;
          setProgress(s, id, progress);
        });
        return id;
      },
      setStage: (id: number, stage: Stage) => edit((s, rules) => setStage(s, id, stage, rules)),
      setProgress: (id: number, p: number) => edit((s) => setProgress(s, id, p)),
      setDiscs: (id: number, n: number) => edit((s, rules) => setDiscs(s, id, n, rules)),
      remove: (id: number) => edit((s, rules) => removeCreature(s, id, rules)),
      fill: (n: number) => edit((s, rules) => fillAdults(s, shownJar, n, rules)),
      clear: () => edit((s) => (s.jars[shownJar]!.creatures = [])),
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
      realSize: (on: boolean) => {
        app.creatures.setRealSize(on);
        showJar(game.state);
      },
      tap: (x: number, y: number) => app.tap(x, y),
      setHour: (h: number) => {
        hourOverride = h;
        applyLight();
      },
      setPhoto: (only: Parameters<App['setPhotoDebug']>[0], overlay: Parameters<App['setPhotoDebug']>[1]) =>
        app.setPhotoDebug(only, overlay),
      setLamp: (on: boolean) => app.setLampOn(on),
    };
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
      game.tick();
      applyLight();
      layout(canvas, app);
    }
    app.frame(dt);
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
