import './style.css';
import { RENDER } from './config';
import { DebugPanel } from './debug/panel';
import { App } from './render/app';
import { hourOf, lightAt } from './render/lighting';

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

/** 写真より横長の画面では、写真の比率で中央に置き、左右は黒で埋める */
function layout(canvas: HTMLCanvasElement, app: App): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(vw, Math.round(vh * RENDER.maxAspect));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${vh}px`;
  app.resize(w, vh, window.devicePixelRatio || 1);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  if (!supportsWebGL2()) {
    document.getElementById('fallback')!.hidden = false;
    return;
  }

  const app = new App(canvas);
  if (debug) {
    // 確認用：中間の画像を出す（?view=scene など）、部品を隠す（?hide=snow,table など）
    app.debugView = params.get('view');
    for (const name of (params.get('hide') ?? '').split(',')) {
      const part = app.parts[name];
      if (part) part.visible = false;
    }
  }
  layout(canvas, app);
  window.addEventListener('resize', () => layout(canvas, app));
  await app.load(import.meta.env.BASE_URL);

  let hourOverride: number | null = null;
  const currentHour = (): number => hourOverride ?? hourOf(new Date());
  let lightTimer = 0;
  const applyLight = (): void => {
    const h = currentHour();
    app.setLight(lightAt(h));
    panel?.showHour(h);
  };

  const panel =
    debug && !capture
    ? new DebugPanel({
        onHour: (h) => {
          hourOverride = h;
          applyLight();
        },
      })
    : null;
  applyLight();

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
      setHour: (h: number) => {
        hourOverride = h;
        applyLight();
      },
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
