import { useSyncExternalStore } from 'react'

import type { ChangeStatus } from '../components/sidebar/sessionResourcePresentation'

// One value per window: each Electron window has its own sessionStorage,
// which also survives a reload of that window.
const OPEN_KEY = 'nuphos.chatSummaryOpen'
const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // Without storage the state still holds for this page's life.
  }
}

const inWindow = typeof window !== 'undefined'
let open = inWindow && read(OPEN_KEY) === '1'

function notify() {
  for (const listener of listeners) listener()
}

export function setChatSummaryOpen(next: boolean): void {
  open = next
  write(OPEN_KEY, next ? '1' : '0')
  notify()
}

export function toggleChatSummary(): void {
  setChatSummaryOpen(!open)
}

/** Which pull requests and issues the panel's Changes list shows. */
export type ChangesFilter = 'all' | ChangeStatus

const FILTER_KEY = 'nuphos.chatSummaryChangesFilter'
const FILTERS: readonly ChangesFilter[] = ['all', 'open', 'merged', 'closed']

function storedFilter(): ChangesFilter {
  const stored = read(FILTER_KEY)

  return FILTERS.find((filter) => filter === stored) ?? 'all'
}

let changesFilter: ChangesFilter = inWindow ? storedFilter() : 'all'

export function setChangesFilter(next: ChangesFilter): void {
  changesFilter = next
  write(FILTER_KEY, next)
  notify()
}

/** Opens the panel on its Changes list showing only `filter`, as the merged badge does. */
export function openChatSummaryChanges(filter: ChangesFilter): void {
  changesFilter = filter
  write(FILTER_KEY, filter)
  setChatSummaryOpen(true)
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

export function useChangesFilter(): ChangesFilter {
  return useSyncExternalStore(
    subscribe,
    () => changesFilter,
    () => 'all',
  )
}

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
