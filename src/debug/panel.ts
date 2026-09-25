// デバッグパネル。URL に ?debug（または #debug）を付けたときだけ出す。
// 時刻の上書き（光の確認用）、背景写真の切り替えと重ね表示（位置合わせの確認用）、FPS、
// 時間の早送りと一気に進める操作、個体（出す・段階・進み・実物大・上限）、状態の表示・リセット・書き出し・読み込み。
import { DEBUG, type PhotoName } from '../config';
import type { GameInfo } from '../game';
import { STAGES, type GameState, type JarState, type Stage } from '../sim/state';

export interface DebugPanelOptions {
  /** 時刻の上書き。null なら端末の時計に従う */
  onHour(hour: number | null): void;
  /** 写真を1枚に固定する／別の写真を半透明で重ねる（null なら使わない） */
  onPhoto(only: PhotoName | null, overlay: PhotoName | null): void;
  /** 早送りの倍率（1 で実時間） */
  onSpeed(rate: number): void;
  /** ms ミリ秒先へ一気に進める */
  onJump(ms: number): void;
  /** 時計を端末の時刻に戻す（進めた分は巻き戻しとして扱われ、経過0） */
  onClockReset(): void;
  /** 状態を最初からにする */
  onReset(): void;
  /** 書き出す JSON */
  onExport(): string;
  /** JSON を読み込む。読めなければ投げる */
  onImport(text: string): void;
  /** 個体：表示中の瓶に出す、段階・進み・皿の数を変える、消す */
  onSpawn(stage: Stage): void;
  onStage(id: number, stage: Stage): void;
  onProgress(id: number, progress: number): void;
  onDiscs(id: number, discs: number): void;
  onRemove(id: number): void;
  /** 泳ぐ個体を成体 n 匹にする（混み具合の確認） */
  onFill(n: number): void;
  /** 泳ぐ個体の上限を差し替える（保存しない） */
  onCap(n: number): void;
  /** ポリプ・ストロビラ・エフィラを実物大で描く */
  onRealSize(on: boolean): void;
}

const PHOTOS: ReadonlyArray<[PhotoName, string]> = [
  ['day', '昼'],
  ['dusk', '夕方'],
  ['night', '夜'],
  ['sakura', '桜'],
];

const STAGE_NAMES: Record<Stage, string> = {
  polyp: 'ポリプ',
  strobila: 'ストロビラ',
  ephyra: 'エフィラ',
  adult: '成体',
};

const UNITS: ReadonlyArray<[number, string]> = [
  [60, '分'],
  [3600, '時間'],
  [86400, '日'],
];

function fmt(hour: number): string {
  const m = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 秒を「3日 4時間」のように（大きい方から2つまで） */
function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const parts: string[] = [];
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) parts.push(`${d}日`);
  if (h) parts.push(`${h}時間`);
  if (m && parts.length < 2) parts.push(`${m}分`);
  if (!parts.length) parts.push(`${s % 60}秒`);
  return parts.slice(0, 2).join(' ');
}

function clockTime(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
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
  private readonly speedBtns: HTMLButtonElement[];
  private readonly driftEl: HTMLDivElement;
  private readonly stateEl: HTMLDivElement;
  private readonly noteEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly stageSel: HTMLSelectElement;
  private readonly discsSel: HTMLSelectElement;
  private readonly progressEl: HTMLInputElement;
  private readonly capSel: HTMLSelectElement;
  /** 選んでいる個体と、進みのつまみを動かしている最中か */
  private selected: number | null = null;
  private pickNewest = false;
  private dragging = false;
  private listKey = '';
  private frames = 0;
  private acc = 0;

  constructor(private readonly opts: DebugPanelOptions) {
    const root = document.createElement('div');
    root.className = 'debug-panel';
    root.innerHTML = `
      <div class="row head" title="たたむ・ひらく"><span class="fps">-- fps</span><span class="time">--:--</span></div>
      <div class="body">
      <input class="slider" type="range" min="0" max="24" step="${1 / 60}" value="12" aria-label="時刻">
      <label class="row"><input class="auto" type="checkbox" checked> 端末の時計に従う</label>
      <div class="row sun"></div>
      <details>
        <summary>写真</summary>
        <label class="row">写真 <select class="only">${options('時刻どおり')}</select></label>
        <label class="row">重ねる <select class="overlay">${options('なし')}</select></label>
      </details>
      <details open>
        <summary>時間</summary>
        <div class="row buttons speeds">${DEBUG.speeds.map((r) => `<button type="button" data-speed="${r}">×${r}</button>`).join('')}</div>
        <div class="row buttons">${DEBUG.jumps.map((s) => `<button type="button" data-jump="${s}">+${span(s)}</button>`).join('')}</div>
        <div class="row">
          <input class="amount" type="number" min="0" step="any" value="3" aria-label="進める量">
          <select class="unit">${UNITS.map(([s, l]) => `<option value="${s}"${s === 3600 ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <button type="button" class="go">進める</button>
        </div>
        <div class="row"><span class="drift sub"></span><button type="button" class="clock-reset">時計を戻す</button></div>
      </details>
      <details open>
        <summary>個体（表示中の瓶）</summary>
        <div class="row buttons spawn">${STAGES.map((st) => `<button type="button" data-spawn="${st}">${STAGE_NAMES[st]}</button>`).join('')}</div>
        <div class="creature-list sub"></div>
        <div class="row selected">
          <select class="stage" aria-label="段階">${STAGES.map((st) => `<option value="${st}">${STAGE_NAMES[st]}</option>`).join('')}</select>
          <select class="discs" aria-label="皿の数">${[1, 2, 3].map((n) => `<option value="${n}">皿${n}</option>`).join('')}</select>
          <button type="button" class="remove">消す</button>
        </div>
        <input class="progress" type="range" min="0" max="1" step="0.001" value="0" aria-label="進み">
        <div class="row buttons">
          <button type="button" data-fill="4">成体4匹</button>
          <button type="button" data-fill="6">成体6匹</button>
          <label>上限 <select class="cap">${[3, 4, 5, 6, 8].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
        </div>
        <label class="row"><input class="real" type="checkbox"> 実物大（ポリプ・エフィラ）</label>
      </details>
      <details>
        <summary>状態</summary>
        <div class="state sub"></div>
        <div class="row buttons">
          <button type="button" class="export">書き出し</button>
          <button type="button" class="import">読み込み</button>
          <button type="button" class="reset">リセット</button>
        </div>
        <div class="note sub"></div>
        <input class="file" type="file" accept="application/json,.json" hidden>
      </details>
      </div>
    `;
    document.body.appendChild(root);
    this.fpsEl = root.querySelector('.fps')!;
    this.timeEl = root.querySelector('.time')!;
    this.sunEl = root.querySelector('.sun')!;
    this.slider = root.querySelector('.slider')!;
    this.auto = root.querySelector('.auto')!;
    this.only = root.querySelector('.only')!;
    this.overlay = root.querySelector('.overlay')!;
    this.speedBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-speed]')];
    this.driftEl = root.querySelector('.drift')!;
    this.stateEl = root.querySelector('.state')!;
    this.noteEl = root.querySelector('.note')!;
    this.listEl = root.querySelector('.creature-list')!;
    // いちばん上の行（fps と時刻）でパネルをたたむ。瓶が隠れないように
    root.querySelector('.head')!.addEventListener('click', () => root.classList.toggle('collapsed'));
    this.stageSel = root.querySelector('.stage')!;
    this.discsSel = root.querySelector('.discs')!;
    this.progressEl = root.querySelector('.progress')!;
    this.capSel = root.querySelector('.cap')!;

    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-spawn]')) {
      b.addEventListener('click', () => {
        // 出した個体を選ぶ（一覧のいちばん下）
        this.selected = null;
        this.pickNewest = true;
        this.opts.onSpawn(b.dataset.spawn as Stage);
      });
    }
    this.listEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (row) {
        this.selected = Number(row.dataset.id);
        this.listKey = '';
      }
    });
    this.stageSel.addEventListener('change', () => {
      if (this.selected !== null) this.opts.onStage(this.selected, this.stageSel.value as Stage);
    });
    this.discsSel.addEventListener('change', () => {
      if (this.selected !== null) this.opts.onDiscs(this.selected, Number(this.discsSel.value));
    });
    root.querySelector('.remove')!.addEventListener('click', () => {
      if (this.selected !== null) this.opts.onRemove(this.selected);
    });
    this.progressEl.addEventListener('pointerdown', () => (this.dragging = true));
    this.progressEl.addEventListener('pointerup', () => (this.dragging = false));
    this.progressEl.addEventListener('input', () => {
      if (this.selected !== null) this.opts.onProgress(this.selected, Number(this.progressEl.value));
    });
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-fill]')) {
      b.addEventListener('click', () => this.opts.onFill(Number(b.dataset.fill)));
    }
    this.capSel.addEventListener('change', () => this.opts.onCap(Number(this.capSel.value)));
    const real = root.querySelector<HTMLInputElement>('.real')!;
    real.addEventListener('change', () => this.opts.onRealSize(real.checked));

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

    for (const b of this.speedBtns) b.addEventListener('click', () => this.opts.onSpeed(Number(b.dataset.speed)));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-jump]')) {
      b.addEventListener('click', () => this.opts.onJump(Number(b.dataset.jump) * 1000));
    }
    const amount = root.querySelector<HTMLInputElement>('.amount')!;
    const unit = root.querySelector<HTMLSelectElement>('.unit')!;
    root.querySelector('.go')!.addEventListener('click', () => {
      const s = Number(amount.value) * Number(unit.value);
      if (s > 0) this.opts.onJump(s * 1000);
    });
    root.querySelector('.clock-reset')!.addEventListener('click', () => this.opts.onClockReset());

    root.querySelector('.export')!.addEventListener('click', () => this.download(this.opts.onExport()));
    const file = root.querySelector<HTMLInputElement>('.file')!;
    root.querySelector('.import')!.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        this.opts.onImport(await f.text());
        this.note('読み込みました');
      } catch (e) {
        this.note(`読み込めません：${e instanceof Error ? e.message : String(e)}`);
      }
    });
    root.querySelector('.reset')!.addEventListener('click', () => {
      if (!confirm('状態を最初からにしますか？（保存も消えます）')) return;
      this.opts.onReset();
      this.note('最初からにしました');
    });

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

  /** ゲームの状態と時計のずれ */
  showState(state: GameState, info: GameInfo, speed: number, drift: number): void {
    for (const b of this.speedBtns) b.classList.toggle('active', Number(b.dataset.speed) === speed);
    this.driftEl.textContent = Math.abs(drift) < 1000 ? '端末の時計どおり' : `端末より ${drift > 0 ? '+' : '−'}${span(Math.abs(drift) / 1000)}`;

    const lines: string[] = [`ゲーム内の経過 ${span(state.time)}`];
    state.jars.forEach((jar, i) => {
      const who = jar.creatures.map((c) => `${STAGE_NAMES[c.stage]} ${span(c.age)}`).join('、');
      lines.push(`瓶${i + 1}　${who || '水だけ'}`);
    });
    lines.push(info.persistent ? `保存 ${info.savedAt ? clockTime(info.savedAt) : 'まだ'}` : '保存しない（この環境では保存できない）');
    if (info.rewound) lines.push('時計の巻き戻し：経過0で続けた');
    else if (info.lastCatchUp > 0) lines.push(`まとめて進めた分 ${span(info.lastCatchUp)}`);
    this.stateEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  /** 表示中の瓶の個体の一覧と、選んでいる個体の段階・進み。cap は泳ぐ個体の上限 */
  showCreatures(jar: JarState, cap: number): void {
    this.capSel.value = String(cap);
    if (this.selected !== null && !jar.creatures.some((c) => c.id === this.selected)) this.selected = null;
    if ((this.selected === null || this.pickNewest) && jar.creatures.length) {
      this.selected = jar.creatures[jar.creatures.length - 1]!.id;
      this.pickNewest = false;
    }
    const key = jar.creatures.map((c) => `${c.id}:${c.stage}:${c.discs}`).join(',') + `|${this.selected}|${jar.resting}`;
    if (key !== this.listKey) {
      this.listKey = key;
      this.listEl.innerHTML =
        jar.creatures
          .map((c) => {
            const sel = c.id === this.selected ? ' class="picked"' : '';
            const discs = c.stage === 'strobila' ? ` 皿${c.discs}` : '';
            return `<div data-id="${c.id}"${sel}>#${c.id} ${STAGE_NAMES[c.stage]}${discs} <span class="pct"></span></div>`;
          })
          .join('') + (jar.resting ? '<div>（いっぱいでポリプが休んでいる）</div>' : '');
    }
    const rows = this.listEl.querySelectorAll<HTMLElement>('[data-id]');
    jar.creatures.forEach((c, i) => {
      const pct = rows[i]?.querySelector('.pct');
      if (pct) pct.textContent = `${Math.round(c.progress * 100)}%`;
    });
    const c = jar.creatures.find((x) => x.id === this.selected);
    if (c) {
      this.stageSel.value = c.stage;
      this.discsSel.disabled = c.stage !== 'strobila';
      if (c.stage === 'strobila') this.discsSel.value = String(c.discs);
      if (!this.dragging) this.progressEl.value = String(c.progress);
    }
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

  private note(text: string): void {
    this.noteEl.textContent = text;
  }

  private download(json: string): void {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kuragebin-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.note('書き出しました');
  }
}
