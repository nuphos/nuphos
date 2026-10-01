import { useSyncExternalStore } from 'react'

// Server-authoritative unread state. The backend counts assistant turn
// boundaries per conversation (`activitySeq`) and keeps the owner's read
// marker (`readSeq`); every device renders from those, so a read anywhere
// clears the badge everywhere on the next list refresh.

export type ConversationReadRow = {
  sessionId: string
  teamId?: string
  activitySeq?: number
  readSeq?: number
}

type ReadState = {
  teamId?: string
  activitySeq: number
  readSeq: number
  /** Highest `activitySeq` delivered with a transcript fetch, i.e. what a view can show. */
  displayedSeq: number
  /** Marker sent but not yet confirmed; dropped on failure so the next read retries. */
  pendingReadSeq: number
}

const PROBE_DELAY_MS = 750
const states = new Map<string, ReadState>()
const readers = new Map<string, Set<() => boolean>>()
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<string> = new Set()

function seq(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function isSessionBeingRead(sessionId: string): boolean {
  return [...(readers.get(sessionId) ?? [])].some((isReading) => isReading())
}

function isUnread(sessionId: string, state: ReadState): boolean {
  return (
    state.activitySeq > Math.max(state.readSeq, state.pendingReadSeq) &&
    !isSessionBeingRead(sessionId)
  )
}

function publish() {
  const next = new Set([...states].filter(([id, state]) => isUnread(id, state)).map(([id]) => id))

  if (next.size === snapshot.size && [...next].every((id) => snapshot.has(id))) return
  snapshot = next
  for (const listener of listeners) listener()
}

function receive(row: ConversationReadRow, displayed: boolean) {
  if (!row.sessionId || row.activitySeq === undefined) return
  const state = states.get(row.sessionId) ?? {
    activitySeq: 0,
    readSeq: 0,
    displayedSeq: 0,
    pendingReadSeq: 0,
  }
  const activitySeq = seq(row.activitySeq)

  state.teamId = row.teamId ?? state.teamId
  state.activitySeq = Math.max(state.activitySeq, activitySeq)
  state.readSeq = Math.max(state.readSeq, seq(row.readSeq))
  if (displayed) state.displayedSeq = Math.max(state.displayedSeq, activitySeq)
  states.set(row.sessionId, state)
}

/** List rows only update what is known; `displayed` rows came with a transcript. */
export function receiveConversationReadStates(
  rows: readonly ConversationReadRow[],
  displayed = false,
) {
  for (const row of rows) receive(row, displayed)
  if (displayed) for (const row of rows) markSessionRead(row.sessionId)
  publish()
}

/** Advance the server marker to what this device has shown, if it is on screen. */
export function markSessionRead(sessionId: string) {
  const state = states.get(sessionId)

  if (!state || !isSessionBeingRead(sessionId)) return
  const target = state.displayedSeq

  if (target <= Math.max(state.readSeq, state.pendingReadSeq)) return
  state.pendingReadSeq = target
  publish()
  void window.api
    .agentMarkConversationRead(sessionId, target, state.teamId)
    .then((confirmed) => {
      receive({ sessionId, ...confirmed }, false)
    })
    .catch(() => {
      // The next transcript fetch while on screen retries.
    })
    .finally(() => {
      if (state.pendingReadSeq === target) state.pendingReadSeq = 0
      publish()
    })
}

/** A turn ended in this conversation. If it is on screen, fetch its new marker right away. */
export function observeSessionTurn(sessionId: string) {
  const teamId = states.get(sessionId)?.teamId

  if (!sessionId || !isSessionBeingRead(sessionId)) return
  setTimeout(() => {
    void window.api
      .agentGetConversation(sessionId, teamId, { tail: 1 })
      .then((detail) => {
        receiveConversationReadStates([detail], true)
      })
      .catch(() => {
        // The catch-up poll fetches the same state shortly.
      })
  }, PROBE_DELAY_MS)
}

// Register each mounted view separately: closing one of two views must not
// clear the other's read ownership. Focus is evaluated at notification time.
export function registerSessionReader(sessionId: string, isReading: () => boolean) {
  const entries = readers.get(sessionId) ?? new Set<() => boolean>()
  const reader = () => isReading()

  entries.add(reader)
  readers.set(sessionId, entries)
  markSessionRead(sessionId)
  publish()

  return () => {
    entries.delete(reader)
    if (entries.size === 0) readers.delete(sessionId)
    publish()
  }
}

/** Focus or visibility changed for a mounted reader. */
export function refreshSessionReader(sessionId: string) {
  markSessionRead(sessionId)
  publish()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return snapshot
}

export function useAgentUnreadSessions(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
