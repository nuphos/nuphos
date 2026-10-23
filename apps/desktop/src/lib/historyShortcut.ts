export type HistoryStep = -1 | 1

/**
 * Back / Forward: ⌘[ / ⌘] on macOS; Alt+← / Alt+→ elsewhere, the browser
 * convention there, since Ctrl+[ is Esc in a terminal.
 */
export function historyShortcut(
  event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac: boolean,
): HistoryStep | null {
  if (event.shiftKey) return null
  const [back, forward] = mac ? ['BracketLeft', 'BracketRight'] : ['ArrowLeft', 'ArrowRight']
  const held = mac
    ? event.metaKey && !event.ctrlKey && !event.altKey
    : event.altKey && !event.ctrlKey && !event.metaKey

  if (!held) return null
  if (event.code === back) return -1
  if (event.code === forward) return 1

  return null
}
