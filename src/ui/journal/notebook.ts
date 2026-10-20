// 観察日誌のメモ帳。上にリングが付いた小さなもので、画面の下寄りに置く（上には瓶が薄く見えたまま）。
// 1ページに1日、新しい日が上。下から上へめくると前の日、下へ引くと1日新しい日へ戻り、いちばん新しい日で下へ引くと閉じる。
// 紙の外をタップしても閉じる。後ろのほうのページに個体一覧（瓶ごと。ここでも名前を付けられる）、
// いちばん最後に設定（音、揺れ、画質、データの書き出し・読み込み）。めくる・開く・閉じるときに小さな紙の音（音がオンのとき）。紙の端から少し出た付箋2枚でそこへ飛べ、
// 一覧と設定のページには「日誌へ」。紙は少しくすんだ色で、夜は部屋の明るさに合わせて暗くする。
// 一覧の次に種のページ（見たことのある種だけ。写真と豆知識。豆知識が増えたら付箋「種」に小さな点）。写真をタップすると大きく見られ、そこから「はがす」。
// 写真が6枚のときに撮ったら、どの写真と入れ替えるかを選ぶ（やめてもよい）。
// その次に標本（拾いもの。写真と名前と拾った日）。写真をタップするとその一枚が少し持ち上がり、下に「瓶に沈める」
// （沈めてある物は「引き上げる」）。沈めるとメモ帳は下がり、瓶の前で沈んでいくところを見せる。
import { NOTEBOOK } from '../../config';
import { NAME_MAX } from '../../sim/actions';
import { feedDay } from '../../sim/feed';
import type { GameState, Settings } from '../../sim/state';
import { downloadText, exportFilename } from '../download';
import { keepToSelf } from '../jarActions';
import { UNNAMED } from '../labels';
import { dayTitle, journalPages, rosterPages, specimenItems, speciesPages, type DayPage, type RosterPage, type SpeciesPage, type SpecimenItem } from './pages';

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
  /** 音を鳴らすか（設定）と、それを変える（鳴らすにしたときは、そのタップの中で鳴らせる状態にする） */
  sound(): boolean;
  setSound(on: boolean): void;
  /** めくる・開く・閉じる音 */
  playSound(name: 'page' | 'open' | 'close'): void;
  /** 画質（高・中・低）と、それを変える */
  quality(): Settings['quality'];
  setQuality(q: Settings['quality']): void;
  /** 日誌のページに留めた手紙をタップした（手紙を読む紙を開く） */
  readLetter(id: number): void;
  /** 種のページ：まだ読んでいない豆知識があるか（付箋の点）。ページを見た（豆知識を読んだことにする）。写真の画像。写真をはがす */
  newFacts(): boolean;
  speciesShown(): void;
  photo(id: number): string | undefined;
  removePhoto(id: number): void;
  /** 標本の物を、見ている瓶に沈める（メモ帳はここで閉じる）。沈められなければ false */
  sinkSpecimen(id: number): boolean;
  /** 沈めてある物を引き上げて標本へ戻す */
  raiseSpecimen(id: number): void;
  /** 開いた・閉じた（日誌を読んだことにする） */
  opened(): void;
  closed(): void;
}

type Leaf =
  | { kind: 'day'; key: string; page: DayPage }
  | { kind: 'roster'; key: string; page: RosterPage }
  | { kind: 'species'; key: string; page: SpeciesPage }
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

/** 画質の選び方（高・中・低） */
const QUALITY_CHOICES: ReadonlyArray<[Settings['quality'], string]> = [
  ['high', '高'],
  ['medium', '中'],
  ['low', '低'],
];

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
  /** 最後に書いた中身の目印（refresh で変わっていなければ書き直さない） */
  private rendered = '';
  /** 写真を大きく見る所と、見ている写真 */
  private viewer!: HTMLElement;
  private viewing: number | null = null;
  /** 写真が6枚のときに撮った：入れ替える写真を選んでいる（新しい写真と、選んだら呼ぶ。やめたら null） */
  private replacing: { url: string; done: (id: number | null) => void } | null = null;
  /** 標本で持ち上げている一枚（タップで持ち上がり、下に「瓶に沈める」か「引き上げる」） */
  private lifted: number | null = null;
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
        <button type="button" class="index-tab to-species">種<i class="new" aria-hidden="true"></i></button>
        <button type="button" class="index-tab to-specimens">標本</button>
        <button type="button" class="index-tab to-settings">設定</button>
      </div>
      <div class="photo-view" hidden>
        <div class="pv-photo"></div>
        <p class="pv-cap"></p>
        <button type="button" class="pv-peel">はがす</button>
        <div class="pv-confirm" hidden><p>はがすと、元に戻せない。</p><div class="data-buttons"><button type="button" class="pv-yes">はがす</button><button type="button" class="pv-no">やめる</button></div></div>
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
    root.querySelector('.to-species')!.addEventListener('click', () => this.jumpTo(this.leaves.findIndex((l) => l.kind === 'species')));
    this.viewer = root.querySelector('.photo-view')!;
    this.viewer.addEventListener('click', (e) => this.viewerClick(e));
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
    this.updateNew();
    this.opts.playSound('open');
    this.opts.opened();
  }

  /** 閉じる */
  close(): void {
    if (!this.shown) return;
    if (this.editing) this.editing.blur();
    this.lifted = null;
    this.closeViewer();
    this.finishReplace(null);
    this.shown = false;
    this.opts.playSound('close');
    this.drag = null;
    this.root.classList.remove('shown');
    this.book.style.transform = '';
    this.opts.closed();
  }

  /** 状態が変わった（開いていれば、今のページのまま書きなおす） */
  refresh(): void {
    this.updateNew();
    if (!this.shown || this.editing || this.busy) return;
    const key = this.leaves[this.cur]?.key;
    this.build();
    // 開いている間もゲームの時間は1秒ごとに進むので、中身が変わっていなければ書き直さない（読んでいる所が先頭へ戻らないように）
    if (this.signature() === this.rendered) return;
    const i = this.leaves.findIndex((l) => l.key === key);
    this.cur = i >= 0 ? i : 0;
    // 同じページなら、読んでいた所のまま
    const top = i >= 0 ? (this.body()?.scrollTop ?? 0) : 0;
    this.renderAll();
    if (top > 0) this.body()?.scrollTo(0, top);
  }

  /** 書いた中身の目印（ページの中身と、設定のページに出す値） */
  private signature(): string {
    return JSON.stringify([this.leaves, this.opts.motion(), this.opts.sound(), this.opts.quality()]);
  }

  /** 部屋の明るさに合わせた紙の明るさ（1 で昼） */
  setLum(lum: number): void {
    this.root.style.setProperty('--lum', lum.toFixed(3));
  }

  /** ページの並び：日（新しい日が先）→ 個体一覧（瓶ごと）→ 種のページ → 標本 → 設定 */
  private build(): void {
    const s = this.opts.state();
    const days: Leaf[] = journalPages(s.journal, { letters: s.letters }).map((page) => ({ kind: 'day', key: `d${page.key}`, page }));
    if (!days.length) {
      const key = feedDay(this.opts.now());
      days.push({ kind: 'day', key: `d${key}`, page: { key, title: dayTitle(key), sections: [], letters: [] } });
    }
    const rosters: Leaf[] = rosterPages(s).map((page) => ({ kind: 'roster', key: `r${page.jar}`, page }));
    const species: Leaf[] = speciesPages(s).map((page) => ({ kind: 'species', key: `p${page.species}`, page }));
    this.leaves = [...days, ...rosters, ...species, { kind: 'specimens', key: 'k', items: specimenItems(s) }, { kind: 'settings', key: 's' }];
  }

  /** 今のページと、その下（次のページ）、上（めくった前のページ）を書く */
  private renderAll(): void {
    this.renderLeaf(this.current, this.cur);
    this.renderLeaf(this.under, this.cur + 1);
    this.renderLeaf(this.over, this.cur - 1);
    this.setAngle(this.current, 0);
    this.setAngle(this.over, 180);
    this.current.querySelector('.leaf-body')?.scrollTo(0, 0);
    this.rendered = this.signature();
    // 種のページを開いた：豆知識を読んだことにする（「初めて種のページを開いたとき」の行も、ここで増える）
    if (this.leaves[this.cur]?.kind === 'species') queueMicrotask(() => this.opts.speciesShown());
  }

  /** 付箋「種」の点（まだ読んでいない豆知識があるとき） */
  private updateNew(): void {
    this.root.querySelector('.to-species')?.classList.toggle('has-new', this.opts.newFacts());
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
    // 設定のページもほかと同じ紙（厚紙の色は字との差が小さく、読みにくいので）
    el.classList.add('paper');
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
    if (leaf.kind === 'species') {
      const p = leaf.page;
      const choosing = this.replacing !== null;
      const photos = p.photos.length
        ? `<div class="specimens sp-photos${choosing ? ' choosing' : ''}">${p.photos
            .map((ph) => {
              const url = this.opts.photo(ph.id);
              return (
                `<div class="specimen" style="--tilt:${(((ph.id * 41) % 7) - 3) * 0.6}deg">` +
                `<button type="button" class="photo sp-photo" data-photo="${ph.id}" aria-label="写真"${url ? ` style="background-image:url('${url}')"` : ''}></button>` +
                `<p class="name">${ph.name ? esc(ph.name) : '&#8203;'}</p><p class="when">${esc(ph.taken)}</p></div>`
              );
            })
            .join('')}</div>`
        : '';
      const replace = this.replacing
        ? `<div class="sp-replace"><div class="photo pending" style="background-image:url('${this.replacing.url}')"></div><p>入れ替える写真を選ぶ</p><button type="button" class="replace-cancel">やめる</button></div>`
        : '';
      const facts = p.facts.map((f) => `<p class="fact">${esc(f.text)}<span class="found">${esc(f.found)}</span></p>`).join('');
      return `<div class="leaf-body"><div class="leaf-head"><h2 class="date">${esc(p.title)}</h2><button type="button" class="to-journal">日誌へ</button></div><p class="sp-since">初めて瓶に来た日　${esc(p.since)}</p>${replace}${photos}<div class="facts">${facts}</div></div>`;
    }
    if (leaf.kind === 'specimens') {
      // 拾った順に、写真と名前と拾った日（沈めてある物は、日付の横にその瓶）。タップした一枚は持ち上がり、下に「瓶に沈める」か「引き上げる」
      const items = leaf.items.length
        ? `<div class="specimens">${leaf.items
            .map((it, i) => {
              const up = it.id === this.lifted;
              const action = up ? `<button type="button" class="${it.where ? 'raise' : 'sink'}">${it.where ? '引き上げる' : '瓶に沈める'}</button>` : '';
              return (
                `<div class="specimen${up ? ' lifted' : ''}${it.where ? ' sunk' : ''}" data-specimen="${it.id}" style="--tilt:${(((it.id * 37) % 7) - 3) * 0.6}deg;--i:${i}">` +
                `<button type="button" class="photo" aria-label="${esc(it.name)}"${it.photo ? ` style="background-image:url('${it.photo}')"` : ''}></button>` +
                `<p class="name">${esc(it.name)}</p><p class="when">${esc(it.found)}${it.where ? `<span class="where">${esc(it.where)}</span>` : ''}</p>${action}</div>`
              );
            })
            .join('')}</div>`
        : `<p class="empty">まだ何もない</p>`;
      return `<div class="leaf-body"><div class="leaf-head"><h2 class="date">標本</h2><button type="button" class="to-journal">日誌へ</button></div><p class="specimen-note">入れ替えた水に混じって、沈んでいたもの。</p>${items}</div>`;
    }
    const on = this.opts.motion();
    const sound = this.opts.sound();
    const quality = this.opts.quality();
    return `<div class="leaf-body"><div class="leaf-head"><h2 class="date">設定</h2><button type="button" class="to-journal">日誌へ</button></div>
      <div class="settings">
      <div class="sound">
        <p class="label">音</p>
        <div class="data-buttons choice"><button type="button" class="sound-on" aria-pressed="${sound}">鳴らす</button><button type="button" class="sound-off" aria-pressed="${!sound}">鳴らさない</button></div>
      </div>
      <div class="motion">
        <p class="label">揺れ</p>
        <p class="hint">端末を傾けたり揺らしたりすると、瓶の水が動く</p>
        <div class="data-buttons choice"><button type="button" class="motion-on" aria-pressed="${on}">使う</button><button type="button" class="motion-off" aria-pressed="${!on}">使わない</button></div>
      </div>
      <div class="quality">
        <p class="label">画質</p>
        <p class="hint">低いほど、電池と熱にやさしい</p>
        <div class="data-buttons choice">${QUALITY_CHOICES.map(([q, label]) => `<button type="button" data-quality="${q}" aria-pressed="${q === quality}">${label}</button>`).join('')}</div>
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
    this.opts.playSound('page');
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
    this.opts.playSound('page');
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
    // 標本：ほかの所をタップしたら、持ち上げていた一枚を下ろす
    if (this.lifted !== null && !t?.closest('[data-specimen]')) this.lift(null);
    if (!t || !this.current.contains(t)) return;
    if (t.classList.contains('sp-photo')) {
      const id = Number(t.dataset.photo);
      if (this.replacing) this.finishReplace(id);
      else this.openViewer(id);
      return;
    }
    if (t.classList.contains('replace-cancel')) {
      this.finishReplace(null);
      this.close();
      return;
    }
    const cell = t.closest<HTMLElement>('[data-specimen]');
    if (cell) {
      const id = Number(cell.dataset.specimen);
      if (t.classList.contains('photo')) this.lift(this.lifted === id ? null : id);
      else if (t.classList.contains('sink')) {
        if (this.opts.sinkSpecimen(id)) this.lifted = null;
      } else if (t.classList.contains('raise')) {
        this.lifted = null;
        this.opts.raiseSpecimen(id);
      }
      return;
    }
    if (t.classList.contains('letter-clip')) this.opts.readLetter(Number(t.dataset.letter));
    else if (t.classList.contains('to-journal')) void this.jumpTo(0);
    else if (t.classList.contains('name')) this.editName(t);
    else if (t.classList.contains('export')) this.exportData();
    else if (t.classList.contains('import')) this.current.querySelector<HTMLInputElement>('.file')?.click();
    else if (t.classList.contains('import-yes')) this.importData();
    else if (t.classList.contains('import-no')) this.cancelImport();
    else if (t.classList.contains('motion-on')) this.opts.setMotion(true);
    else if (t.classList.contains('motion-off')) this.opts.setMotion(false);
    else if (t.classList.contains('sound-on')) this.opts.setSound(true);
    else if (t.classList.contains('sound-off')) this.opts.setSound(false);
    else if (t.dataset.quality) this.opts.setQuality(t.dataset.quality as Settings['quality']);
  }

  /**
   * 写真が6枚のときに撮った：種のページを開いて、どの写真と入れ替えるかを選ばせる（url は新しい写真）。
   * 選んだら done(その写真の番号)、やめたら done(null)
   */
  openReplace(url: string, done: (id: number | null) => void): void {
    this.finishReplace(null);
    if (!this.shown) this.open();
    this.replacing = { url, done };
    const i = this.leaves.findIndex((l) => l.kind === 'species');
    if (i >= 0) this.cur = i;
    this.renderAll();
  }

  private finishReplace(id: number | null): void {
    const r = this.replacing;
    if (!r) return;
    this.replacing = null;
    r.done(id);
    if (this.shown) {
      this.build();
      this.renderAll();
    }
  }

  /** 写真を大きく見る（名前と撮った日、「はがす」） */
  private openViewer(id: number): void {
    const url = this.opts.photo(id);
    const leaf = this.leaves[this.cur];
    const ph = leaf?.kind === 'species' ? leaf.page.photos.find((p) => p.id === id) : undefined;
    if (!url || !ph) return;
    this.viewing = id;
    this.viewer.querySelector<HTMLElement>('.pv-photo')!.style.backgroundImage = `url('${url}')`;
    this.viewer.querySelector('.pv-cap')!.textContent = `${ph.name ? `${ph.name}　` : ''}${ph.taken}`;
    this.viewer.querySelector<HTMLElement>('.pv-confirm')!.hidden = true;
    this.viewer.querySelector<HTMLElement>('.pv-peel')!.hidden = false;
    this.viewer.hidden = false;
  }

  private closeViewer(): void {
    this.viewing = null;
    this.viewer.hidden = true;
  }

  private viewerClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    const confirm = this.viewer.querySelector<HTMLElement>('.pv-confirm')!;
    const peel = this.viewer.querySelector<HTMLElement>('.pv-peel')!;
    if (t?.classList.contains('pv-peel')) {
      // 取り消せないので、一度だけ確かめる
      confirm.hidden = false;
      peel.hidden = true;
    } else if (t?.classList.contains('pv-yes')) {
      const id = this.viewing;
      this.closeViewer();
      if (id !== null) this.opts.removePhoto(id);
    } else if (t?.classList.contains('pv-no')) {
      confirm.hidden = true;
      peel.hidden = false;
    } else if (!(e.target as HTMLElement).closest('.pv-photo')) {
      this.closeViewer();
    }
  }

  /** 標本の一枚を持ち上げる（null で下ろす）。今のページを書き直す */
  private lift(id: number | null): void {
    if (this.lifted === id) return;
    this.lifted = id;
    const body = this.body();
    const top = body?.scrollTop ?? 0;
    this.renderLeaf(this.current, this.cur);
    this.setAngle(this.current, 0);
    this.body()?.scrollTo(0, top);
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
