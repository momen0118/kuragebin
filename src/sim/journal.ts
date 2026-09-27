// 観察日誌への書き込み。記録は消さずに全部残す（文にするのは日誌を開いたとき、ui/journal）。
import type { GameState, JournalKind } from './state';

/** 日誌に出来事を足す。name はその行の主な個体の名前（名無しなら null） */
export function record(state: GameState, kind: JournalKind, jar: number, count: number, ids: number[], wall: number, name: string | null = null): void {
  state.journal.push({ kind, jar, count, ids, time: state.time, wallTime: wall, name });
}

/** 未読の出来事があるか（日誌のアイコンの点） */
export function hasUnread(state: GameState): boolean {
  return state.journal.length > state.journalSeen;
}
