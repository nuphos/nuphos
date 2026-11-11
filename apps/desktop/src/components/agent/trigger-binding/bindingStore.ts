import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { api } from '../../../api'

import { bindingsBySession } from './bindings'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

// One Trigger list per team feeds every sidebar row and header chip. It is
// re-read on a slow leash while anything shows it, and when the window regains
// focus, so a schedule changed elsewhere shows up without each row asking.
const REFRESH_MS = 60_000
const STALE_MS = 15_000

type Entry = {
  triggers: AgentTrigger[]
  map: Map<string, AgentTrigger[]>
  loadedAt: number
  inflight: Promise<void> | null
  listeners: Set<() => void>
  timer: number | null
}

const noop = () => null
const EMPTY = new Map<string, AgentTrigger[]>()
const entries = new Map<string, Entry>()

function entryOf(teamId: string): Entry {
  let entry = entries.get(teamId)

  if (!entry) {
    entry = {
      triggers: [],
      map: EMPTY,
      loadedAt: 0,
      inflight: null,
      listeners: new Set(),
      timer: null,
    }
    entries.set(teamId, entry)
  }

  return entry
}

function publish(entry: Entry, triggers: AgentTrigger[]) {
  entry.triggers = triggers
  entry.map = bindingsBySession(triggers)
  for (const listener of entry.listeners) listener()
}

/** Re-reads the team's Triggers; concurrent callers share one request. */
export function refreshTriggerBindings(teamId: string, force = false): Promise<void> {
  const entry = entryOf(teamId)

  if (entry.inflight) return entry.inflight
  if (!force && Date.now() - entry.loadedAt < STALE_MS) return Promise.resolve()
  const request = api
    .agentListTriggers(teamId)
    .then((triggers) => {
      entry.loadedAt = Date.now()
      publish(entry, triggers)
    })
    // Offline or refused: keep what was shown; the next tick tries again.
    .catch(() => {
      // Nothing to show for it.
    })
    .finally(() => {
      entry.inflight = null
    })

  entry.inflight = request

  return request
}

/** A Trigger changed here (paused, resumed): every mark of it updates at once. */
export function replaceTriggerBinding(teamId: string, next: AgentTrigger) {
  const entry = entryOf(teamId)

  publish(
    entry,
    entry.triggers.map((trigger) => (trigger.id === next.id ? { ...trigger, ...next } : trigger)),
  )
}

const onFocus = () => {
  for (const [teamId, entry] of entries) {
    if (entry.listeners.size > 0) void refreshTriggerBindings(teamId)
  }
}

function subscribe(teamId: string, listener: () => void): () => void {
  const entry = entryOf(teamId)

  if (entry.listeners.size === 0) {
    entry.timer = window.setInterval(() => void refreshTriggerBindings(teamId), REFRESH_MS)
    if (![...entries.values()].some((other) => other !== entry && other.listeners.size > 0)) {
      window.addEventListener('focus', onFocus)
    }
  }
  entry.listeners.add(listener)

  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size > 0) return
    if (entry.timer !== null) window.clearInterval(entry.timer)
    entry.timer = null
    if (![...entries.values()].some((other) => other.listeners.size > 0)) {
      window.removeEventListener('focus', onFocus)
    }
  }
}

/** The team's Triggers by the conversation each one is bound to. */
export function useTriggerBindings(
  teamId: string | undefined,
): ReadonlyMap<string, AgentTrigger[]> {
  const onChange = useCallback(
    (listener: () => void) => (teamId ? subscribe(teamId, listener) : noop),
    [teamId],
  )
  const map = useSyncExternalStore(onChange, () => (teamId ? entryOf(teamId).map : EMPTY))

  useEffect(() => {
    if (teamId) void refreshTriggerBindings(teamId)
  }, [teamId])

  return map
}
