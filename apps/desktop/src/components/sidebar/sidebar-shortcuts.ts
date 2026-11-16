import type { SidebarTabOrder } from './sidebar-tab-order.ts'

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented' | 'isComposing'
>

/** Number shortcuts address positions, so dragging a tab also moves its shortcut. */
export function sidebarShortcutPage(event: ShortcutEvent, order: SidebarTabOrder, mac: boolean) {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.shiftKey) return
  if (mac ? !event.ctrlKey || event.altKey : !event.altKey || event.ctrlKey) return
  if (!/^[1-3]$/.test(event.key)) return

  return order[Number(event.key) - 1]
}
