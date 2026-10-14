import { useSyncExternalStore } from 'react'

/**
 * Whether the chat summary panel is open. One value per window: Electron gives
 * each window its own sessionStorage, which also survives a reload of that
 * window, so a second window starts with its own state.
 */
const STORAGE_KEY = 'nuphos.chatSummaryOpen'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let open = typeof window === 'undefined' ? false : read()

export function setChatSummaryOpen(next: boolean): void {
  open = next
  try {
    window.sessionStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  } catch {
    // Storage can be unavailable; the panel still toggles for this page's life.
  }
  for (const listener of listeners) listener()
}

export function toggleChatSummary(): void {
  setChatSummaryOpen(!open)
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function useChatSummaryOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}

/** ⌘I on macOS, Ctrl+I elsewhere; the physical key, so a layout or ⌥ cannot change it. */
export function isChatSummaryShortcut(
  event: Pick<
    KeyboardEvent,
    'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code' | 'isComposing'
  >,
  mac: boolean,
): boolean {
  return (
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === 'KeyI' &&
    !event.isComposing
  )
}
