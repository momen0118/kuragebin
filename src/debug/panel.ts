// デバッグパネル。URL に ?debug（または #debug）を付けたときだけ出す。
// 時刻の上書き（光の確認用）、背景写真の切り替えと重ね表示（位置合わせの確認用）、FPS。
import type { PhotoName } from '../config';

export interface DebugPanelOptions {
  /** 時刻の上書き。null なら端末の時計に従う */
  onHour(hour: number | null): void;
  /** 写真を1枚に固定する／別の写真を半透明で重ねる（null なら使わない） */
  onPhoto(only: PhotoName | null, overlay: PhotoName | null): void;
}

const PHOTOS: ReadonlyArray<[PhotoName, string]> = [
  ['day', '昼'],
  ['dusk', '夕方'],
  ['night', '夜'],
  ['sakura', '桜'],
];

function fmt(hour: number): string {
  const m = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function options(none: string): string {
  return `<option value="">${none}</option>` + PHOTOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
}

export class DebugPanel {
  private readonly fpsEl: HTMLSpanElement;
  private readonly timeEl: HTMLSpanElement;
  private readonly sunEl: HTMLSpanElement;
  private readonly slider: HTMLInputElement;
  private readonly auto: HTMLInputElement;
  private readonly only: HTMLSelectElement;
  private readonly overlay: HTMLSelectElement;
  private frames = 0;
  private acc = 0;

  constructor(private readonly opts: DebugPanelOptions) {
    const root = document.createElement('div');
    root.className = 'debug-panel';
    root.innerHTML = `
      <div class="row"><span class="fps">-- fps</span><span class="time">--:--</span></div>
      <input class="slider" type="range" min="0" max="24" step="${1 / 60}" value="12" aria-label="時刻">
      <label class="row"><input class="auto" type="checkbox" checked> 端末の時計に従う</label>
      <div class="row sun"></div>
      <label class="row">写真 <select class="only">${options('時刻どおり')}</select></label>
      <label class="row">重ねる <select class="overlay">${options('なし')}</select></label>
    `;
    document.body.appendChild(root);
    this.fpsEl = root.querySelector('.fps')!;
    this.timeEl = root.querySelector('.time')!;
    this.sunEl = root.querySelector('.sun')!;
    this.slider = root.querySelector('.slider')!;
    this.auto = root.querySelector('.auto')!;
    this.only = root.querySelector('.only')!;
    this.overlay = root.querySelector('.overlay')!;

    this.slider.addEventListener('input', () => {
      this.auto.checked = false;
      this.opts.onHour(Number(this.slider.value));
    });
    this.auto.addEventListener('change', () => {
      this.opts.onHour(this.auto.checked ? null : Number(this.slider.value));
    });
    const photo = (): void => {
      this.opts.onPhoto((this.only.value || null) as PhotoName | null, (this.overlay.value || null) as PhotoName | null);
    };
    this.only.addEventListener('change', photo);
    this.overlay.addEventListener('change', photo);
    // パネルの操作が画面の操作として拾われないように
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('pointerup', (e) => e.stopPropagation());
  }

  /** 表示中の時刻（上書き中でなければスライダーも追従させる）と、その日の日の出・日の入り */
  showHour(hour: number, sunrise: number, sunset: number): void {
    this.timeEl.textContent = fmt(hour);
    this.sunEl.textContent = `日の出 ${fmt(sunrise)}　日の入り ${fmt(sunset)}`;
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
}
