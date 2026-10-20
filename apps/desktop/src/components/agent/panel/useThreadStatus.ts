import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../../../api'
import { publishRuntimeStates, useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'

import { threadStatusOf } from './threadStatus'

import type { ThreadStatus } from './threadStatus'

// A running turn reads as stopped once its snapshot is 12 s old, so re-read
// well inside that while the thread works.
const ACTIVE_POLL_MS = 5_000

type ThreadEntry = { title: string | null; failed: boolean }

// One read and one poll per thread, however many badges in the chat point at it.
let entries: ReadonlyMap<string, ThreadEntry> = new Map()
const listeners = new Set<() => void>()
const reading = new Set<string>()
const pollers = new Map<string, { users: number; timer: number }>()

const keyOf = (threadId: string, teamId: string | undefined) => `${teamId ?? ''}|${threadId}`

function setEntry(key: string, entry: ThreadEntry) {
  entries = new Map(entries).set(key, entry)
  for (const listener of listeners) listener()
}

/** Publishes the thread's runtime state for every reader and stores its title. */
function read(threadId: string, teamId: string | undefined) {
  const key = keyOf(threadId, teamId)

  if (reading.has(key)) return
  reading.add(key)
  api
    .agentGetConversation(threadId, teamId, { tail: 1 })
    .then(
      (detail) => {
        if (detail.runtimeState) publishRuntimeStates([[threadId, detail.runtimeState]])
        setEntry(key, { title: detail.title || null, failed: false })
      },
      // A failed poll keeps what an earlier read showed.
      () => entries.has(key) || setEntry(key, { title: null, failed: true }),
    )
    .finally(() => reading.delete(key))
}

function poll(threadId: string, teamId: string | undefined): () => void {
  const key = keyOf(threadId, teamId)
  const poller = pollers.get(key) ?? {
    users: 0,
    timer: window.setInterval(() => {
      if (document.visibilityState === 'visible') read(threadId, teamId)
    }, ACTIVE_POLL_MS),
  }

  poller.users += 1
  pollers.set(key, poller)

  return () => {
    poller.users -= 1
    if (poller.users > 0) return
    window.clearInterval(poller.timer)
    pollers.delete(key)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => entries

/** A sub-thread's title and whether it is still working, kept fresh while it runs. */
export function useThreadStatus(
  threadId: string | null,
  teamId: string | undefined,
): { title: string | null; status: ThreadStatus } {
  const snapshot = useAgentRuntimeStates().get(threadId ?? '')
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot).get(
    keyOf(threadId ?? '', teamId),
  )
  const status: ThreadStatus = entry?.failed ? 'unavailable' : threadStatusOf(snapshot)
  const active = status === 'running' || status === 'waiting'

  // Once for the title (and the state, if no other view has it yet)…
  useEffect(() => {
    if (threadId && !entries.has(keyOf(threadId, teamId))) read(threadId, teamId)
  }, [teamId, threadId])

  // …then again while the thread works, so it turns Done without a reload.
  useEffect(
    () => (threadId && active ? poll(threadId, teamId) : undefined),
    [active, teamId, threadId],
  )

  return { title: entry?.title ?? null, status: threadId ? status : 'loading' }
}
