import type { ShortcutInput } from './sessionShortcuts.ts'

export type HistoryShortcutAction = 'history-back' | 'history-forward'

/**
 * Back / Forward: ⌘[ / ⌘] on macOS; Alt+← / Alt+→ elsewhere, the browser
 * convention there, since Ctrl+[ is Esc in a terminal.
 */
export function historyShortcut(
  input: Pick<ShortcutInput, 'code' | 'meta' | 'control' | 'alt' | 'shift'>,
  mac: boolean,
): HistoryShortcutAction | null {
  if (input.shift) return null
  const [back, forward] = mac ? ['BracketLeft', 'BracketRight'] : ['ArrowLeft', 'ArrowRight']
  const held = mac
    ? input.meta && !input.control && !input.alt
    : input.alt && !input.control && !input.meta

  if (!held) return null
  if (input.code === back) return 'history-back'
  if (input.code === forward) return 'history-forward'

  return null
}
