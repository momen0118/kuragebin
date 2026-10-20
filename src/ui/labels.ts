// 画面に出す言葉（段階の名前など）。
import type { Stage } from '../sim/state';

export const STAGE_LABELS: Record<Stage, string> = {
  polyp: 'ポリプ',
  strobila: 'ストロビラ',
  ephyra: 'エフィラ',
  adult: '成体',
};

/** 名前のない個体 */
export const UNNAMED = '名無し';

/** 拾いものの名前（種類と色。標本に書く） */
export const FIND_NAMES: Readonly<Record<string, string>> = {
  'glass-white': '白いシーグラス',
  'glass-green': '淡い緑のシーグラス',
  'glass-brown': '茶色のシーグラス',
  'glass-aqua': '水色のシーグラス',
  'glass-amber': '琥珀色のシーグラス',
  'glass-blue': '青いシーグラス',
  'glass-lavender': '薄紫のシーグラス',
  'glass-red': '赤いシーグラス',
  'shell-white': '白い貝殻のかけら',
  'shell-pink': '桃色の貝殻のかけら',
  'shell-striped': '縞のある貝殻のかけら',
  'shell-purple': '紫がかった貝殻のかけら',
  'pebble-gray': '灰色の小石',
  'pebble-black': '黒い小石',
  'pebble-white': '白い小石',
  'pebble-rust': '赤茶の小石',
  'pebble-banded': '縞のある小石',
};
