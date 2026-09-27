// 右下の、瓶に何かをする操作のアイコンを並べる場所。いちばん隅が餌、その内側がライト（夜だけ）。
// 中央は瓶の点3つに空けておく。

export function jarActions(): HTMLElement {
  let box = document.querySelector<HTMLElement>('.jar-actions');
  if (!box) {
    box = document.createElement('div');
    box.className = 'jar-actions';
    document.body.appendChild(box);
  }
  return box;
}

/** 画面をつつく操作として拾われないように */
export function keepToSelf(el: HTMLElement): void {
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('pointerup', (e) => e.stopPropagation());
}
