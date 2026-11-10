// A dialog or menu has the keyboard (⌘K palette, settings): the panel behind it stays as it is.
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * ⌘I on macOS, Ctrl+I elsewhere; the physical key, so a layout or ⌥ cannot
 * change it. Not while focus is inside a dialog or menu.
 */
export function isChatSummaryShortcut(
  event: Pick<
    KeyboardEvent,
    'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code' | 'isComposing'
  > & { target: EventTarget | null },
  mac: boolean,
): boolean {
  const target = event.target as { closest?: (selector: string) => unknown } | null

  if (target?.closest?.(OVERLAY)) return false

  return (
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === 'KeyI' &&
    !event.isComposing
  )
}
