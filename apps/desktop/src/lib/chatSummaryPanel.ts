import { useEffect, useSyncExternalStore } from 'react'

import { inWindow, loadOpenChats, read, saveOpenChats, write } from './chatSummaryStorage.ts'

import type { ChangeStatus } from '../components/sidebar/sessionResourcePresentation'

const listeners = new Set<() => void>()

/** The id the first pane starts with. */
export const PRIMARY_PANE_ID = 'primary'

// Each chat remembers its own panel: open in one chat, it stays closed in the
// next until opened there, and is open again on coming back. A pane showing no
// chat (a new one) keeps its own entry, `pane:<id>`, which is not persisted.
const openKeys = new Set<string>(inWindow ? loadOpenChats() : [])
// The chat each pane is showing, so a badge can open the panel only where its chat is.
const paneSessions = new Map<string, string>()

function keyOf(paneId: string): string {
  return paneSessions.get(paneId) ?? `pane:${paneId}`
}

function persist() {
  saveOpenChats([...openKeys].filter((key) => !key.startsWith('pane:')))
}

// An open asked for a chat no pane shows yet ("before switching to that chat").
let pendingOpenFor: string | null = null
let pendingOpenAt = 0

/** A list the panel can be opened on. */
type RevealSection = 'changes' | 'subAgents'

// Bumped by each openChatSummaryChanges or openChatSummarySubAgents call, even
// one that changes nothing else, so the panel can scroll to the list again.
// `revealFor` is the chat whose `revealTarget` list should do so, asked at
// `revealAt`, until that list takes it, the panel closes or
// REVEAL_LIFETIME_MS passes.
let revealRequest = 0
let revealFor: string | null = null
let revealTarget: RevealSection = 'changes'
let revealAt = 0

/** A reveal not taken by then is stale: coming back to the chat later should not scroll it. */
export const REVEAL_LIFETIME_MS = 5000

function notify() {
  for (const listener of listeners) listener()
}

/** Opens or closes the panel for the chat this pane shows. */
export function setChatSummaryOpen(paneId: string, next: boolean): void {
  const key = keyOf(paneId)

  // Re-adding moves the chat to the end, so the limit forgets the oldest first.
  openKeys.delete(key)
  if (next) {
    openKeys.add(key)
  } else if (revealFor !== null && paneSessions.get(paneId) === revealFor) {
    // Closing drops a reveal this pane never made, so a later open stays put.
    revealFor = null
  }
  persist()
  notify()
}

export function toggleChatSummary(paneId: string): void {
  setChatSummaryOpen(paneId, !openKeys.has(keyOf(paneId)))
}

/** Whether the panel is open for the chat this pane shows, for code outside React. */
export function isChatSummaryOpen(paneId: string): boolean {
  return openKeys.has(keyOf(paneId))
}

/** Records which chat a pane shows; a pending badge open for that chat lands here. */
export function setPaneSession(paneId: string, sessionId: string | null, now = Date.now()): void {
  if (sessionId === null) {
    paneSessions.delete(paneId)
    notify()

    return
  }
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

function requestReveal(section: RevealSection, sessionId: string) {
  revealRequest += 1
  revealFor = sessionId
  revealTarget = section
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

function takeReveal(section: RevealSection, sessionId: string, now: number): boolean {
  if (revealFor !== sessionId || revealTarget !== section || now - revealAt > REVEAL_LIFETIME_MS)
    return false
  revealFor = null

  return true
}

/**
 * Opens the panel on its Changes list showing only `filter`, as the merged
 * badge does, and asks the list of chat `sessionId` to come into view. Call it
 * before or after switching to that chat; another chat's list ignores it.
 */
export function openChatSummaryChanges(filter: ChangesFilter, sessionId: string): void {
  changesFilter = filter
  write(FILTER_KEY, filter)
  requestReveal('changes', sessionId)
}

/**
 * True once per openChatSummaryChanges call, only for the chat it named and
 * within REVEAL_LIFETIME_MS: the caller brings that chat's Changes list into
 * view. Other chats' lists, such as another split's, leave it in place.
 */
export function takeChangesReveal(sessionId: string, now = Date.now()): boolean {
  return takeReveal('changes', sessionId, now)
}

/**
 * Opens the panel on its Sub-agents list showing only `filter`, and asks the
 * list of chat `sessionId` to come into view, as openChatSummaryChanges does
 * for Changes. Call it before or after switching to that chat.
 */
export function openChatSummarySubAgents(filter: SubAgentsFilter, sessionId: string): void {
  subAgentsFilter = filter
  write(SUB_AGENTS_FILTER_KEY, filter)
  requestReveal('subAgents', sessionId)
}

/** As takeChangesReveal, for an openChatSummarySubAgents call. */
export function takeSubAgentsReveal(sessionId: string, now = Date.now()): boolean {
  return takeReveal('subAgents', sessionId, now)
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function useChatSummaryOpen(paneId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openKeys.has(keyOf(paneId)),
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

/**
 * Changes with every openChatSummaryChanges and openChatSummarySubAgents call;
 * pair with takeChangesReveal or takeSubAgentsReveal.
 */
export function useSummaryRevealRequest(): number {
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
