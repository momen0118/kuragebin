// 観察日誌のメモ帳。上にリングが付いた小さなもので、画面の下寄りに置く（上には瓶が薄く見えたまま）。
// 1ページに1日、新しい日が上。下から上へめくると前の日、下へ引くと1日新しい日へ戻り、いちばん新しい日で下へ引くと閉じる。
// 紙の外をタップしても閉じる。後ろのほうのページに個体一覧（瓶ごと。ここでも名前を付けられる）、
// いちばん最後（裏表紙の内側）に設定（揺れを使うか、データの書き出し・読み込み）。紙の端から少し出た付箋2枚でそこへ飛べ、
// 一覧と設定のページには「日誌へ」。紙は少しくすんだ色で、夜は部屋の明るさに合わせて暗くする。
// 一覧と設定の間に標本（拾いもの。写真と名前と拾った日）。標本の物を長押しすると、瓶へ運べる（メモ帳は下がる）。
import { HANDLING, NOTEBOOK } from '../../config';
import { NAME_MAX } from '../../sim/actions';
import { feedDay } from '../../sim/feed';
import type { GameState } from '../../sim/state';
import { downloadText, exportFilename } from '../download';
import { keepToSelf } from '../jarActions';
import { UNNAMED } from '../labels';
import { dayTitle, journalPages, rosterPages, specimenItems, type DayPage, type RosterPage, type SpecimenItem } from './pages';

export interface NotebookOptions {
  state(): GameState;
  /** 今の端末の時刻（何も書かれていないときのページの日付） */
  now(): number;
  rename(id: number, name: string): void;
  exportJson(): string;
  /** 書き出したデータを読み込む。読めなければ投げる */
  importJson(text: string): void;
  /** 揺れを使うか（設定）と、それを変える（使うにしたときは、ここで許可を訊く） */
  motion(): boolean;
  setMotion(on: boolean): void;
  /** 日誌のページに留めた手紙をタップした（手紙を読む紙を開く） */
  readLetter(id: number): void;
  /** 標本の物を長押しした：瓶へ運びはじめる（写真、指の位置と番号）。メモ帳は閉じる */
  carrySpecimen(id: number, photo: string | null, x: number, y: number, pointer: number): void;
  /** 開いた・閉じた（日誌を読んだことにする） */
  opened(): void;
  closed(): void;
}

type Leaf =
  | { kind: 'day'; key: string; page: DayPage }
  | { kind: 'roster'; key: string; page: RosterPage }
  | { kind: 'specimens'; key: string; items: SpecimenItem[] }
  | { kind: 'settings'; key: string };

type Drag = {
  pointer: number;
  x0: number;
  y0: number;
  y: number;
  t: number;
  vy: number;
  /** 決まるまでは 'pending'。縦に動いたら、めくる・戻す・閉じる・ページの中を送る */
  mode: 'pending' | 'up' | 'down' | 'close' | 'scroll' | 'none';
  scroll0: number;
  moved: boolean;
};

const RINGS = 11;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - x) * (1 - x) * (1 - x);
};

export class Notebook {
  private readonly root: HTMLDivElement;
  private readonly book: HTMLDivElement;
  private readonly under: HTMLElement;
  private readonly current: HTMLElement;
  private readonly over: HTMLElement;
  private leaves: Leaf[] = [];
  private cur = 0;
  private shown = false;
  private drag: Drag | null = null;
  /** めくっている最中（アニメーション） */
  private busy = false;
  private suppressClick = false;
  /** 標本の物の長押しを待っている（指を置いた所から動かずに押し続けたら、瓶へ運ぶ） */
  private hold: { timer: number; id: number; pointer: number; x: number; y: number } | null = null;
  private editing: HTMLInputElement | null = null;
  private pendingImport: string | null = null;
  private readonly reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(private readonly opts: NotebookOptions) {
    const root = document.createElement('div');
    root.className = 'journal';
    root.innerHTML = `
      <div class="journal-scrim"></div>
      <div class="notebook" role="dialog" aria-label="観察日誌" tabindex="-1">
        <div class="pad-edge"></div>
        <div class="leaves">
          <section class="leaf under"></section>
          <section class="leaf current"></section>
          <section class="leaf over"></section>
        </div>
        <div class="rings" aria-hidden="true">${'<span></span>'.repeat(RINGS)}</div>
        <button type="button" class="index-tab to-roster">一覧</button>
        <button type="button" class="index-tab to-specimens">標本</button>
        <button type="button" class="index-tab to-settings">設定</button>
      </div>`;
    document.body.appendChild(root);
    keepToSelf(root);
    this.root = root;
    this.book = root.querySelector('.notebook')!;
    this.under = root.querySelector('.leaf.under')!;
    this.current = root.querySelector('.leaf.current')!;
    this.over = root.querySelector('.leaf.over')!;

    root.querySelector('.journal-scrim')!.addEventListener('click', () => this.close());
    root.querySelector('.to-roster')!.addEventListener('click', () => this.jumpTo(this.leaves.findIndex((l) => l.kind === 'roster')));
    root.querySelector('.to-specimens')!.addEventListener('click', () => this.jumpTo(this.leaves.findIndex((l) => l.kind === 'specimens')));
    root.querySelector('.to-settings')!.addEventListener('click', () => this.jumpTo(this.leaves.length - 1));
    this.book.addEventListener('pointerdown', (e) => this.down(e));
    this.book.addEventListener('pointermove', (e) => this.move(e));
    this.book.addEventListener('pointerup', (e) => this.up(e));
    this.book.addEventListener('pointercancel', (e) => this.up(e));
    // めくったあとのクリックは、ボタンに届けない
    this.book.addEventListener(
      'click',
      (e) => {
        if (this.suppressClick) {
          this.suppressClick = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
    this.book.addEventListener('click', (e) => this.click(e));
    this.book.addEventListener('change', (e) => void this.fileChosen(e));
    root.addEventListener('keydown', (e) => {
      if (this.editing) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowUp' || e.key === 'PageDown') void this.flip(1);
      else if (e.key === 'ArrowDown' || e.key === 'PageUp') void this.flip(-1);
    });
    window.visualViewport?.addEventListener('resize', () => this.fitKeyboard());
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /** 開く。いちばん新しい日から */
  open(): void {
    if (this.shown) return;
    this.shown = true;
    this.build();
    this.cur = 0;
    this.renderAll();
    this.root.classList.add('shown');
    this.book.style.transform = '';
    this.book.focus({ preventScroll: true });
    this.opts.opened();
  }

  /** 閉じる */
  close(): void {
    if (!this.shown) return;
    if (this.editing) this.editing.blur();
    this.cancelHold();
    this.shown = false;
    this.drag = null;
    this.root.classList.remove('shown');
    this.book.style.transform = '';
    this.opts.closed();
  }

  /** 状態が変わった（開いていれば、今のページのまま書きなおす） */
  refresh(): void {
    if (!this.shown || this.editing || this.busy) return;
    const key = this.leaves[this.cur]?.key;
    this.build();
    const i = this.leaves.findIndex((l) => l.key === key);
    this.cur = i >= 0 ? i : 0;
    this.renderAll();
  }

  /** 部屋の明るさに合わせた紙の明るさ（1 で昼） */
  setLum(lum: number): void {
    this.root.style.setProperty('--lum', lum.toFixed(3));
  }

  /** ページの並び：日（新しい日が先）→ 個体一覧（瓶ごと）→ 標本 → 設定（裏表紙の内側） */
  private build(): void {
    const s = this.opts.state();
    const days: Leaf[] = journalPages(s.journal, { letters: s.letters }).map((page) => ({ kind: 'day', key: `d${page.key}`, page }));
    if (!days.length) {
      const key = feedDay(this.opts.now());
      days.push({ kind: 'day', key: `d${key}`, page: { key, title: dayTitle(key), sections: [], letters: [] } });
    }
    const rosters: Leaf[] = rosterPages(s).map((page) => ({ kind: 'roster', key: `r${page.jar}`, page }));
    this.leaves = [...days, ...rosters, { kind: 'specimens', key: 'k', items: specimenItems(s) }, { kind: 'settings', key: 's' }];
  }

  /** 今のページと、その下（次のページ）、上（めくった前のページ）を書く */
  private renderAll(): void {
    this.renderLeaf(this.current, this.cur);
    this.renderLeaf(this.under, this.cur + 1);
    this.renderLeaf(this.over, this.cur - 1);
    this.setAngle(this.current, 0);
    this.setAngle(this.over, 180);
    this.current.querySelector('.leaf-body')?.scrollTo(0, 0);
  }

  private renderLeaf(el: HTMLElement, index: number): void {
    const leaf = this.leaves[index];
    el.className = `leaf ${el === this.current ? 'current' : el === this.under ? 'under' : 'over'}`;
    if (!leaf) {
      // いちばん最後のページの下は、裏表紙
      el.classList.add('cover', 'blank');
      el.innerHTML = '';
      return;
    }
    el.classList.add(leaf.kind === 'settings' ? 'cover' : 'paper');
    el.dataset.index = String(index);
    el.innerHTML = `<div class="holes" aria-hidden="true">${'<i></i>'.repeat(RINGS)}</div>${this.leafHtml(leaf)}<div class="shade"></div>`;
  }

  private leafHtml(leaf: Leaf): string {
    if (leaf.kind === 'day') {
      // 瓶によらない行（おじさん）には見出しを付けない
      const sections = leaf.page.sections
        .map((s) => `${s.title ? `<h3 class="jar">${esc(s.title)}</h3>` : ''}${s.lines.map((l) => `<p class="line">${esc(l)}</p>`).join('')}`)
        .join('');
      // その日に届いた手紙は、ページの右上にクリップで留める（タップで読める）
      const clips = leaf.page.letters
        .map(
          (id, i) =>
            `<button type="button" class="letter-clip" data-letter="${id}" style="--i:${i}" aria-label="手紙"><span class="clip" aria-hidden="true"></span><span class="scribble" aria-hidden="true"><i></i><i></i><i></i></span></button>`,
        )
        .join('');
      return `<div class="leaf-body"><h2 class="date">${esc(leaf.page.title)}</h2>${sections}</div>${clips}`;
    }
    if (leaf.kind === 'roster') {
      // 送った子のページは、名前を付け直せない（もういないので）。日は送った日
      const sent = leaf.page.jar < 0;
      const rows = leaf.page.rows.length
        ? `<div class="roster-head"><span>名前</span><span>段階</span><span>${sent ? '送った日' : '来た日'}</span></div>` +
          leaf.page.rows
            .map(
              (r) =>
                `<div class="roster-row" data-id="${r.id}">` +
                (sent
                  ? `<span class="name${r.name ? '' : ' unnamed'}">${esc(r.name ?? UNNAMED)}</span>`
                  : `<button type="button" class="name${r.name ? '' : ' unnamed'}">${esc(r.name ?? UNNAMED)}</button>`) +
                `<span class="what">${esc(r.species)}・${esc(r.stage)}</span><span class="when">${esc(r.arrived)}</span></div>`,
            )
            .join('')
        : `<p class="empty">水だけ</p>`;
      return `<div class="leaf-body"><div class="leaf-head"><h2 class="date">${esc(leaf.page.title)}</h2><button type="button" class="to-journal">日誌へ</button></div>${rows}</div>`;
    }
    if (leaf.kind === 'specimens') {
      // 拾った順に、写真と名前と拾った日（どの瓶かは書かない）
      const items = leaf.items.length
        ? `<div class="specimens">${leaf.items
            .map(
              (it, i) =>
                `<div class="specimen" data-specimen="${it.id}" style="--tilt:${(((it.id * 37) % 7) - 3) * 0.6}deg;--i:${i}">` +
                `<div class="photo"${it.photo ? ` style="background-image:url('${it.photo}')"` : ''}></div>` +
                `<p class="name">${esc(it.name)}</p><p class="when">${esc(it.found)}</p></div>`,
            )
            .join('')}</div>`
        : `<p class="empty">まだ何もない</p>`;
      return `<div class="leaf-body"><div class="leaf-head"><h2 class="date">標本</h2><button type="button" class="to-journal">日誌へ</button></div><p class="specimen-note">入れ替えた水に混じって、沈んでいたもの。</p>${items}</div>`;
    }
    const on = this.opts.motion();
    return `<div class="leaf-body"><div class="leaf-head"><span></span><button type="button" class="to-journal">日誌へ</button></div>
      <div class="settings">
      <div class="motion">
        <p class="label">揺れ</p>
        <p class="hint">端末を傾けたり揺らしたりすると、瓶の水が動く</p>
        <div class="data-buttons choice"><button type="button" class="motion-on" aria-pressed="${on}">使う</button><button type="button" class="motion-off" aria-pressed="${!on}">使わない</button></div>
      </div>
      <div class="data">
        <p class="label">データ</p>
        <p class="hint">機種を変えるときに</p>
        <div class="data-buttons"><button type="button" class="export">書き出す</button><button type="button" class="import">読み込む</button></div>
        <div class="confirm" hidden><p>今の瓶は、読み込んだ中身に置き換わる。</p><div class="data-buttons"><button type="button" class="import-yes">読み込む</button><button type="button" class="import-no">やめる</button></div></div>
        <p class="note" aria-live="polite"></p>
        <input type="file" class="file" accept="application/json,.json" hidden>
      </div>
      <p class="version">版 ${esc(__APP_VERSION__)}</p></div></div>`;
  }

  /** ページの傾き（0 で平ら、180 でリングの向こうへめくれている）。90 を越えると裏になって見えない */
  private setAngle(el: HTMLElement, angle: number): void {
    el.style.transform = `rotateX(${angle.toFixed(2)}deg)`;
    const shade = el.querySelector<HTMLElement>('.shade');
    if (shade) shade.style.opacity = (Math.sin((Math.min(angle, 90) * Math.PI) / 180) * 0.25).toFixed(3);
  }

  /** 角度を duration 秒かけて動かす */
  private animate(el: HTMLElement, from: number, to: number, seconds: number): Promise<void> {
    const ms = this.reduced ? 1 : seconds * 1000;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number): void => {
        const k = ease((now - t0) / ms);
        this.setAngle(el, from + (to - from) * k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** 1枚めくる（dir 1 で前の日のほうへ、-1 で新しい日のほうへ）。先がなければ何もしない */
  private async flip(dir: 1 | -1, from?: number): Promise<void> {
    if (this.busy) return;
    const next = this.cur + dir;
    if (next < 0 || next >= this.leaves.length) return;
    this.busy = true;
    if (dir > 0) {
      const a = from ?? 0;
      await this.animate(this.current, a, 180, NOTEBOOK.flipSeconds * (1 - a / 180));
    } else {
      const a = from ?? 90;
      await this.animate(this.over, a, 0, NOTEBOOK.flipSeconds * (a / 90) * 0.8);
    }
    this.cur = next;
    this.renderAll();
    this.busy = false;
  }

  /** 付箋や「日誌へ」で、index のページへ一気に飛ぶ（1枚めくる動きで見せる） */
  private async jumpTo(index: number): Promise<void> {
    if (this.busy || index < 0 || index === this.cur || index >= this.leaves.length) return;
    if (this.editing) this.editing.blur();
    this.busy = true;
    if (index > this.cur) {
      this.renderLeaf(this.under, index);
      await this.animate(this.current, 0, 180, NOTEBOOK.flipSeconds);
    } else {
      this.renderLeaf(this.over, index);
      this.setAngle(this.over, 90);
      await this.animate(this.over, 90, 0, NOTEBOOK.flipSeconds * 0.8);
    }
    this.cur = index;
    this.renderAll();
    this.busy = false;
  }

  private body(): HTMLElement | null {
    return this.current.querySelector<HTMLElement>('.leaf-body');
  }

  private down(e: PointerEvent): void {
    if (this.drag || this.busy || this.editing) return;
    this.drag = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, y: e.clientY, t: performance.now(), vy: 0, mode: 'pending', scroll0: 0, moved: false };
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-specimen]');
    if (cell && this.current.contains(cell)) {
      const id = Number(cell.dataset.specimen);
      const hold = { timer: 0, id, pointer: e.pointerId, x: e.clientX, y: e.clientY };
      hold.timer = window.setTimeout(() => this.holdFired(), HANDLING.longPressMs);
      this.hold = hold;
    }
  }

  /** 標本の物を長押しした：メモ帳を閉じて、瓶へ運びはじめる */
  private holdFired(): void {
    const h = this.hold;
    this.hold = null;
    if (!h || !this.shown) return;
    const item = this.leaves[this.cur]?.kind === 'specimens' ? (this.leaves[this.cur] as { items: SpecimenItem[] }).items.find((x) => x.id === h.id) : undefined;
    if (!item) return;
    this.drag = null;
    this.suppressClick = true;
    this.close();
    this.opts.carrySpecimen(h.id, item.photo, h.x, h.y, h.pointer);
  }

  private cancelHold(): void {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.hold = null;
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    const now = performance.now();
    const dt = Math.max(now - d.t, 1) / 1000;
    d.vy = d.vy * 0.6 + ((e.clientY - d.y) / dt) * 0.4;
    d.y = e.clientY;
    d.t = now;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (this.hold) {
      if (Math.hypot(dx, dy) >= NOTEBOOK.dragPx) this.cancelHold();
      else {
        this.hold.x = e.clientX;
        this.hold.y = e.clientY;
      }
    }
    if (d.mode === 'pending') {
      if (Math.abs(dy) < NOTEBOOK.dragPx || Math.abs(dy) < Math.abs(dx)) return;
      d.moved = true;
      this.book.setPointerCapture(e.pointerId);
      const body = this.body();
      const max = body ? body.scrollHeight - body.clientHeight : 0;
      // 中身が紙に収まっていないときは、先にページの中を送る
      if (body && max > 1 && ((dy < 0 && body.scrollTop < max - 1) || (dy > 0 && body.scrollTop > 1))) {
        d.mode = 'scroll';
        d.scroll0 = body.scrollTop;
      } else if (dy < 0) d.mode = this.cur < this.leaves.length - 1 ? 'up' : 'none';
      else d.mode = this.cur > 0 ? 'down' : 'close';
      if (d.mode === 'down') this.setAngle(this.over, 90);
    }
    const H = this.book.clientHeight;
    switch (d.mode) {
      case 'scroll': {
        const body = this.body();
        if (body) body.scrollTop = d.scroll0 - dy;
        break;
      }
      case 'up': {
        // 紙の下の端が指についてくるように（上から見た高さ H·cos）
        const q = Math.max(0, -dy) / H;
        this.setAngle(this.current, q <= 1 ? (Math.acos(1 - q) * 180) / Math.PI : 90 + Math.min(q - 1, 1) * 90);
        break;
      }
      case 'down': {
        const q = Math.min(Math.max(dy / H, 0), 1);
        this.setAngle(this.over, (Math.acos(q) * 180) / Math.PI);
        break;
      }
      case 'close':
        this.book.style.transition = 'none';
        this.book.style.transform = `translate(-50%, ${Math.max(0, dy).toFixed(1)}px)`;
        break;
      default:
        break;
    }
  }

  private up(e: PointerEvent): void {
    this.cancelHold();
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    if (d.moved) this.suppressClick = true;
    const H = this.book.clientHeight;
    const dy = d.y - d.y0;
    switch (d.mode) {
      case 'up': {
        const q = -dy / H;
        const angle = q <= 1 ? (Math.acos(1 - Math.max(q, 0)) * 180) / Math.PI : 90 + Math.min(q - 1, 1) * 90;
        if (q > NOTEBOOK.flipAt || d.vy < -NOTEBOOK.flipSpeed) void this.flip(1, angle);
        else void this.settle(this.current, angle, 0);
        break;
      }
      case 'down': {
        const q = Math.min(Math.max(dy / H, 0), 1);
        const angle = (Math.acos(q) * 180) / Math.PI;
        if (q > NOTEBOOK.flipAt || d.vy > NOTEBOOK.flipSpeed) void this.flip(-1, angle);
        else void this.settle(this.over, angle, 90).then(() => this.setAngle(this.over, 180));
        break;
      }
      case 'close':
        this.book.style.transition = '';
        if (dy > H * NOTEBOOK.closeAt || d.vy > NOTEBOOK.flipSpeed) this.close();
        else this.book.style.transform = '';
        break;
      default:
        break;
    }
  }

  /** めくりかけたページを戻す */
  private async settle(el: HTMLElement, from: number, to: number): Promise<void> {
    this.busy = true;
    await this.animate(el, from, to, NOTEBOOK.flipSeconds * 0.6);
    this.busy = false;
  }

  private click(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || !this.current.contains(t)) return;
    if (t.classList.contains('letter-clip')) this.opts.readLetter(Number(t.dataset.letter));
    else if (t.classList.contains('to-journal')) void this.jumpTo(0);
    else if (t.classList.contains('name')) this.editName(t);
    else if (t.classList.contains('export')) this.exportData();
    else if (t.classList.contains('import')) this.current.querySelector<HTMLInputElement>('.file')?.click();
    else if (t.classList.contains('import-yes')) this.importData();
    else if (t.classList.contains('import-no')) this.cancelImport();
    else if (t.classList.contains('motion-on')) this.opts.setMotion(true);
    else if (t.classList.contains('motion-off')) this.opts.setMotion(false);
  }

  /** 個体一覧で名前を付ける。Enter か欄の外で決まり、Esc でやめる。16px 未満だと iOS が画面を拡大する */
  private editName(button: HTMLElement): void {
    const row = button.closest<HTMLElement>('[data-id]');
    if (!row || this.editing) return;
    const id = Number(row.dataset.id);
    const c = this.opts.state().jars.flatMap((j) => j.creatures).find((x) => x.id === id);
    if (!c) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name';
    input.value = c.name ?? '';
    input.placeholder = UNNAMED;
    input.maxLength = NAME_MAX;
    input.enterKeyHint = 'done';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', '名前');
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      this.editing = null;
      this.root.classList.remove('editing');
      this.root.style.removeProperty('--kb');
      if (save) this.opts.rename(id, input.value);
      this.build();
      this.renderAll();
    };
    input.addEventListener('keydown', (e) => {
      // かな漢字変換の確定の Enter では閉じない
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    button.replaceWith(input);
    this.editing = input;
    this.root.classList.add('editing');
    input.focus();
    input.select();
    this.fitKeyboard();
  }

  /** 名前を入れている間は、キーボードに隠れないようメモ帳を持ち上げる */
  private fitKeyboard(): void {
    if (!this.editing) return;
    const vv = window.visualViewport;
    const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    this.root.style.setProperty('--kb', `${covered.toFixed(0)}px`);
  }

  private note(text: string): void {
    const el = this.current.querySelector('.note');
    if (el) el.textContent = text;
  }

  private exportData(): void {
    try {
      downloadText(this.opts.exportJson(), exportFilename());
      this.note('書き出した');
    } catch {
      this.note('書き出せなかった');
    }
  }

  private async fileChosen(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains('file')) return;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.pendingImport = await f.text();
    const confirm = this.current.querySelector<HTMLElement>('.confirm');
    if (confirm) confirm.hidden = false;
    this.note('');
  }

  private importData(): void {
    const text = this.pendingImport;
    this.pendingImport = null;
    if (text === null) return;
    try {
      this.opts.importJson(text);
      this.build();
      this.cur = this.leaves.length - 1;
      this.renderAll();
      this.note('読み込んだ');
    } catch (err) {
      this.cancelImport();
      this.note(`読み込めなかった（${err instanceof Error ? err.message : String(err)}）`);
    }
  }

  private cancelImport(): void {
    this.pendingImport = null;
    const confirm = this.current.querySelector<HTMLElement>('.confirm');
    if (confirm) confirm.hidden = true;
  }
}
