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

// Bumped by each openChatSummaryChanges call, even one that changes nothing
// else, so the panel can scroll to the list again. `revealFor` is the chat
// whose list should do so, asked at `revealAt`, until that list takes it, the
// panel closes or REVEAL_LIFETIME_MS passes.
let revealRequest = 0
let revealFor: string | null = null
let revealAt = 0

/** A reveal not taken by then is stale: coming back to the chat later should not scroll it. */
export const REVEAL_LIFETIME_MS = 5000

function notify() {
  for (const listener of listeners) listener()
}

export function setChatSummaryOpen(next: boolean): void {
  open = next
  // Closing drops a reveal the panel never made, so a later open stays put.
  if (!next) revealFor = null
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

/**
 * Opens the panel on its Changes list showing only `filter`, as the merged
 * badge does, and asks the list of chat `sessionId` to come into view. Call it
 * before or after switching to that chat; another chat's list ignores it.
 */
export function openChatSummaryChanges(filter: ChangesFilter, sessionId: string): void {
  changesFilter = filter
  write(FILTER_KEY, filter)
  revealRequest += 1
  revealFor = sessionId
  revealAt = Date.now()
  setChatSummaryOpen(true)
}

/**
 * True once per openChatSummaryChanges call, only for the chat it named and
 * within REVEAL_LIFETIME_MS: the caller brings that chat's Changes list into
 * view. Other chats' lists, such as another split's, leave it in place.
 */
export function takeChangesReveal(sessionId: string, now = Date.now()): boolean {
  if (revealFor !== sessionId || now - revealAt > REVEAL_LIFETIME_MS) return false
  revealFor = null

  return true
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

/** Changes with every openChatSummaryChanges call; pair with takeChangesReveal. */
export function useChangesRevealRequest(): number {
  return useSyncExternalStore(
    subscribe,
    () => revealRequest,
    () => 0,
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
