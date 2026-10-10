import { useSyncExternalStore } from 'react'

import { api } from '../api'

import type { WorkspaceStore } from '../app/workspace/store/workspaceStore'

const sources = new Map<WorkspaceStore, Record<string, string[]>>()
const listeners = new Set<() => void>()
const empty: string[] = []
let snapshot: Record<string, string[]> = {}

function publish() {
  const next: Record<string, string[]> = {}

  for (const sessions of sources.values()) {
    for (const [sessionId, names] of Object.entries(sessions)) {
      next[sessionId] = [...new Set([...(next[sessionId] ?? []), ...names])]
    }
  }
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return
  snapshot = next
  for (const notify of listeners) notify()
}

/** One poll per workspace, independent of which session's dock is rendered. */
export function observeTerminalProcesses(store: WorkspaceStore): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const poll = async () => {
    const sessions: Record<string, string[]> = {}
    const buckets = store.getState().buckets
    const tabSessions = new Map<string, string>()

    for (const [sessionId, bucket] of Object.entries(buckets)) {
      if (sessionId.startsWith('__')) continue
      for (const tab of bucket.tabs) {
        if (tab.active === 'team.terminal') tabSessions.set(tab.id, sessionId)
      }
    }
    try {
      if (tabSessions.size) {
        for (const process of await api.localTerminalProcesses()) {
          const sessionId = tabSessions.get(process.id)

          if (sessionId) {
            sessions[sessionId] ??= []
            sessions[sessionId].push(process.name)
          }
        }
      }
    } catch {
      // A closed window or unavailable PTY must never retain stale activity.
    }
    if (stopped) return
    sources.set(store, sessions)
    publish()
    timer = setTimeout(() => void poll(), 1000)
  }

  void poll()

  return () => {
    stopped = true
    clearTimeout(timer)
    sources.delete(store)
    publish()
  }
}

export function useSessionTerminalProcesses(sessionId: string): string[] {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)

      return () => listeners.delete(notify)
    },
    () => snapshot[sessionId] ?? empty,
  )
}
