// 夜のデスクライトのオン・オフ。夜の間だけ右下の隅に小さなアイコンを出す（昼・夕方は出さない）。
// 右下は瓶に何かをする操作の場所（あとで餌をいちばん隅に並べる）。中央は瓶の点3つに空けておく。

const ICON = `
<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 20.5h8" />
  <path d="M9 20.5V10a5 5 0 0 1 5-5h0.8" />
  <path d="M14.8 5h3.4l1.8 4h-7z" />
  <path class="beam" d="M14 11.2l-0.9 1.9M16.5 11.4v2.1M19 11.2l0.9 1.9" />
</svg>`;

/** 右下の、瓶に何かをする操作のアイコンを並べる場所 */
function jarActions(): HTMLElement {
  let box = document.querySelector<HTMLElement>('.jar-actions');
  if (!box) {
    box = document.createElement('div');
    box.className = 'jar-actions';
    document.body.appendChild(box);
  }
  return box;
}

export class LampToggle {
  private readonly el: HTMLButtonElement;

  constructor(private readonly onChange: (on: boolean) => void, private on = true) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lamp-toggle';
    el.setAttribute('aria-label', '照明');
    el.innerHTML = ICON;
    el.addEventListener('click', () => {
      this.on = !this.on;
      this.render();
      this.onChange(this.on);
    });
    // 画面をつつく操作として拾われないように
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointerup', (e) => e.stopPropagation());
    jarActions().appendChild(el);
    this.el = el;
    this.render();
  }

  /** オン・オフを外から合わせる（読み込んだ設定など） */
  set(on: boolean): void {
    this.on = on;
    this.render();
  }

  /** 夜（ライトが点く時間）だけ出す */
  setVisible(visible: boolean): void {
    this.el.classList.toggle('shown', visible);
    this.el.tabIndex = visible ? 0 : -1;
  }

  private render(): void {
    this.el.classList.toggle('on', this.on);
    this.el.setAttribute('aria-pressed', String(this.on));
  }
}
