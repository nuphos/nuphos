/**
 * ⌥⌘C (Ctrl+Alt+C elsewhere) copies the latest reply. Matched by physical key,
 * since ⌥C types ç on macOS; off macOS Ctrl+Alt is AltGr, so it must read as c.
 */
export function isCopyReplyKey(
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'
  >,
  mac: boolean,
): boolean {
  if (event.isComposing || event.shiftKey || !event.altKey || event.code !== 'KeyC') return false
  if (mac) return event.metaKey && !event.ctrlKey

  return event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'c'
}
