// デバッグパネル。URL に ?debug を付けたときだけ出す。
// フェーズ1では、時刻の上書き（光の確認用）と FPS だけ。

export interface DebugPanelOptions {
  /** 時刻の上書き。null なら端末の時計に従う */
  onHour(hour: number | null): void;
}

function fmt(hour: number): string {
  const m = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export class DebugPanel {
  private readonly root: HTMLDivElement;
  private readonly fpsEl: HTMLSpanElement;
  private readonly timeEl: HTMLSpanElement;
  private readonly slider: HTMLInputElement;
  private readonly auto: HTMLInputElement;
  private frames = 0;
  private acc = 0;

  constructor(private readonly opts: DebugPanelOptions) {
    const root = document.createElement('div');
    root.className = 'debug-panel';
    root.innerHTML = `
      <div class="row"><span class="fps">-- fps</span><span class="time">--:--</span></div>
      <input class="slider" type="range" min="0" max="24" step="${1 / 60}" value="12" aria-label="時刻">
      <label class="row"><input class="auto" type="checkbox" checked> 端末の時計に従う</label>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.fpsEl = root.querySelector('.fps')!;
    this.timeEl = root.querySelector('.time')!;
    this.slider = root.querySelector('.slider')!;
    this.auto = root.querySelector('.auto')!;

    this.slider.addEventListener('input', () => {
      this.auto.checked = false;
      this.opts.onHour(Number(this.slider.value));
    });
    this.auto.addEventListener('change', () => {
      this.opts.onHour(this.auto.checked ? null : Number(this.slider.value));
    });
    // パネルの操作が画面の操作として拾われないように
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** 表示中の時刻（上書き中でなければスライダーも追従させる） */
  showHour(hour: number): void {
    this.timeEl.textContent = fmt(hour);
    if (this.auto.checked) this.slider.value = String(hour);
  }

  tick(dt: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.acc)} fps`;
      this.frames = 0;
      this.acc = 0;
    }
  }

  get element(): HTMLElement {
    return this.root;
  }
}
