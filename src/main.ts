import './style.css';
import { DebugPanel } from './debug/panel';
import { App } from './render/app';
import { hourOf, lightAt, sunOf } from './render/lighting';
import { onTap } from './ui/tap';

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

/** 画面いっぱいに描く（写真より横長なら、写真の左右は黒に溶かす） */
function layout(canvas: HTMLCanvasElement, app: App): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;
  app.resize(vw, vh, window.devicePixelRatio || 1);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  if (!supportsWebGL2()) {
    document.getElementById('fallback')!.hidden = false;
    return;
  }

  const app = new App(canvas);
  if (debug) {
    // 確認用：中間の画像を出す（?view=bg / contents / glow / room）、部品を隠す（?hide=snow,table など）
    app.debugView = params.get('view');
    app.setPatternDebug(params.has('pattern'));
    for (const name of (params.get('hide') ?? '').split(',')) {
      const part = app.parts[name];
      if (part) part.visible = false;
    }
  }
  layout(canvas, app);
  window.addEventListener('resize', () => layout(canvas, app));
  await app.load(import.meta.env.BASE_URL);

  let hourOverride: number | null = null;
  let lightTimer = 0;
  const applyLight = (): void => {
    const now = new Date();
    const sun = sunOf(now);
    const h = hourOverride ?? hourOf(now);
    app.setLight(lightAt(h, sun));
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
        })
      : null;
  applyLight();

  // 瓶をつつく（海月の上のタップは、フェーズ3で札を出すために空けておく）
  onTap(canvas, (x, y) => {
    app.tap(x, y);
  });

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  if (capture) {
    const w = window as unknown as Record<string, unknown>;
    w.__kurage = {
      frame: (dt: number) => app.frame(dt),
      simulate: (seconds: number) => {
        for (let t = 0; t < seconds; t += 1 / 60) app.simulate(1 / 60);
      },
      jelly: () => app.jellyScreenPosition(canvas.clientWidth, canvas.clientHeight),
      tap: (x: number, y: number) => app.tap(x, y),
      setHour: (h: number) => {
        hourOverride = h;
        applyLight();
      },
      setPhoto: (only: Parameters<App['setPhotoDebug']>[0], overlay: Parameters<App['setPhotoDebug']>[1]) =>
        app.setPhotoDebug(only, overlay),
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
    if (lightTimer > 1) {
      lightTimer = 0;
      applyLight();
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
  // タブが見えていない間は描画を止める
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });
  start();
}

void main();
