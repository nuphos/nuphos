import { useEffect, useSyncExternalStore } from 'react'

import { inWindow, read, write } from './chatSummaryStorage.ts'

import type { ChangeStatus } from '../components/sidebar/sessionResourcePresentation'

const listeners = new Set<() => void>()

/** The id the first pane starts with. */
export const PRIMARY_PANE_ID = 'primary'

// Keyed by chat, so panes on the same chat share its panel; a pane showing no
// chat (a new one) keeps its own entry, `pane:<id>`. A chat starts closed each
// time a pane switches to it, and nothing outlives a reload.
const openKeys = new Set<string>()
// The chat each pane is showing, so a badge can open the panel only where its chat is.
const paneSessions = new Map<string, string>()
// The chat each pane showed last, kept while it unmounts: a remount is not a switch.
const paneLastSessions = new Map<string, string>()

function keyOf(paneId: string): string {
  return paneSessions.get(paneId) ?? `pane:${paneId}`
}

function shownElsewhere(paneId: string, sessionId: string): boolean {
  for (const [id, shown] of paneSessions) if (id !== paneId && shown === sessionId) return true

  return false
}

// An open asked for a chat no pane shows yet ("before switching to that chat").
let pendingOpenFor: string | null = null
let pendingOpenAt = 0

// Bumped by each openChatSummaryChanges call, even one that changes nothing
// else, so the panel can scroll to the list again. `revealFor` is the chat
// whose Changes list should do so, asked at `revealAt`, until that list takes
// it, the panel closes or REVEAL_LIFETIME_MS passes.
let revealRequest = 0
let revealFor: string | null = null
let revealAt = 0

/** A reveal not taken by then is stale: coming back to the chat later should not scroll it. */
export const REVEAL_LIFETIME_MS = 5000

function notify() {
  for (const listener of listeners) listener()
}

// The dock and the panel share the right edge, so an open dock takes it: each
// pane keeps its chat's choice for when the dock closes, and meanwhile opening
// the panel only peeks at it, floating over the transcript until dismissed.
const docked = new Set<string>()
const peeking = new Set<string>()

/** Tells the store whether the dock beside this pane is open. */
export function setChatSummaryDocked(paneId: string, next: boolean): void {
  if (next === docked.has(paneId)) return
  if (next) docked.add(paneId)
  else docked.delete(paneId)
  peeking.delete(paneId)
  notify()
}

/** Opens or closes the panel for the chat this pane shows. */
export function setChatSummaryOpen(paneId: string, next: boolean): void {
  if (docked.has(paneId)) {
    if (next) peeking.add(paneId)
    else peeking.delete(paneId)
    notify()

    return
  }

  const key = keyOf(paneId)

  // Re-adding moves the chat to the end, so the limit forgets the oldest first.
  openKeys.delete(key)
  if (next) {
    openKeys.add(key)
  } else if (revealFor !== null && paneSessions.get(paneId) === revealFor) {
    // Closing drops a reveal this pane never made, so a later open stays put.
    revealFor = null
  }
  notify()
}

export function toggleChatSummary(paneId: string): void {
  setChatSummaryOpen(paneId, !isChatSummaryOpen(paneId))
}

/** Whether the panel is showing for the chat this pane shows, for code outside React. */
export function isChatSummaryOpen(paneId: string): boolean {
  return docked.has(paneId) ? peeking.has(paneId) : openKeys.has(keyOf(paneId))
}

/** Records which chat a pane shows; a pending badge open for that chat lands here. */
export function setPaneSession(paneId: string, sessionId: string | null, now = Date.now()): void {
  if (sessionId === null) {
    paneSessions.delete(paneId)
    notify()

    return
  }
  // A peek beside the dock belongs to the chat it was opened on.
  if (paneSessions.get(paneId) !== sessionId) peeking.delete(paneId)
  // Switching to a chat starts it closed, unless another pane shows it open now.
  if (paneLastSessions.get(paneId) !== sessionId && !shownElsewhere(paneId, sessionId))
    openKeys.delete(sessionId)
  paneLastSessions.set(paneId, sessionId)
  paneSessions.set(paneId, sessionId)
  notify()
  if (pendingOpenFor === sessionId && now - pendingOpenAt <= REVEAL_LIFETIME_MS) {
    pendingOpenFor = null
    setChatSummaryOpen(paneId, true)
  }
}

/** Records which chat a pane shows, so the pane reads that chat's panel. */
export function useRegisterPaneSession(paneId: string, sessionId: string | null): void {
  useEffect(() => {
    setPaneSession(paneId, sessionId)

    return () => setPaneSession(paneId, null)
  }, [paneId, sessionId])

  // A closed pane leaves no state for a chat-less view behind; chats keep theirs.
  useEffect(
    () => () => {
      openKeys.delete(`pane:${paneId}`)
      docked.delete(paneId)
      peeking.delete(paneId)
    },
    [paneId],
  )
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

/** Which of this chat's sub-agents the panel lists. */
export type SubAgentsFilter = 'all' | 'active' | 'done'

const SUB_AGENTS_FILTER_KEY = 'nuphos.chatSummarySubAgentsFilter'
const SUB_AGENTS_FILTERS: readonly SubAgentsFilter[] = ['all', 'active', 'done']

// Active until a pill is chosen: a chat with nothing active shows All instead.
function storedSubAgentsFilter(): SubAgentsFilter {
  const stored = read(SUB_AGENTS_FILTER_KEY)

  return SUB_AGENTS_FILTERS.find((filter) => filter === stored) ?? 'active'
}

let subAgentsFilter: SubAgentsFilter = inWindow ? storedSubAgentsFilter() : 'active'

export function setSubAgentsFilter(next: SubAgentsFilter): void {
  subAgentsFilter = next
  write(SUB_AGENTS_FILTER_KEY, next)
  notify()
}

function requestReveal(sessionId: string) {
  revealRequest += 1
  revealFor = sessionId
  revealAt = Date.now()
  pendingOpenFor = null

  let shown = false

  for (const [paneId, id] of paneSessions) {
    if (id !== sessionId) continue
    shown = true
    setChatSummaryOpen(paneId, true)
  }
  if (!shown) {
    pendingOpenFor = sessionId
    pendingOpenAt = revealAt
  }
  notify() // the request counter changed even if no pane opened
}

/**
 * Opens the panel on its Changes list showing only `filter`, as the merged
 * badge does, and asks the list of chat `sessionId` to come into view. Call it
 * before or after switching to that chat; another chat's list ignores it.
 */
export function openChatSummaryChanges(filter: ChangesFilter, sessionId: string): void {
  changesFilter = filter
  write(FILTER_KEY, filter)
  requestReveal(sessionId)
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

export function useChatSummaryOpen(paneId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isChatSummaryOpen(paneId),
    () => false,
  )
}

/** Whether the dock has the right edge, so the panel can only float as a peek. */
export function useChatSummaryDocked(paneId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => docked.has(paneId),
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

export function useSubAgentsFilter(): SubAgentsFilter {
  return useSyncExternalStore(
    subscribe,
    () => subAgentsFilter,
    () => 'active',
  )
}

/** Changes with every openChatSummaryChanges call; pair with takeChangesReveal. */
export function useSummaryRevealRequest(): number {
  return useSyncExternalStore(
    subscribe,
    () => revealRequest,
    () => 0,
  )
}
