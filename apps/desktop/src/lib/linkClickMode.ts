/** A chat link click: ⌘-click (Ctrl elsewhere) opens beside, a plain click opens in place, anything else is the browser's. */
export function linkClickMode(
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  mac: boolean,
): 'open' | 'beside' | null {
  if (event.button !== 0 || event.shiftKey || event.altKey) return null
  if (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) return 'beside'

  return event.metaKey || event.ctrlKey ? null : 'open'
}
