import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { publishRuntimeStates, useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import { runtimeTurnActive } from '../../../lib/runtimeExecution'

import type { RuntimeExecution } from '../../../lib/runtimeExecution'

export type ThreadStatus = 'loading' | 'running' | 'waiting' | 'done' | 'stopped' | 'unavailable'

// A running turn reads as stopped once its snapshot is 12 s old, so re-read
// well inside that while the thread works.
const ACTIVE_POLL_MS = 5_000

function statusOf(snapshot: RuntimeExecution | undefined): ThreadStatus {
  if (!snapshot) return 'loading'
  if (runtimeTurnActive(snapshot)) {
    // A pending request is the turn itself; only a permission prompt waits on a person.
    return (snapshot.permissionWaits ?? 0) > 0 ? 'waiting' : 'running'
  }

  return snapshot.state === 'interrupted' || snapshot.state === 'disconnected' ? 'stopped' : 'done'
}

/** Publishes the thread's runtime state for every reader and returns its title. */
async function readThread(threadId: string, teamId: string | undefined): Promise<string | null> {
  const detail = await api.agentGetConversation(threadId, teamId, { tail: 1 })

  publishRuntimeStates([
    [
      threadId,
      { ...(detail.runtimeState ?? { state: 'unsupported' }), observedAt: performance.now() },
    ],
  ])

  return detail.title || null
}

/** A sub-thread's title and whether it is still working, kept fresh while it runs. */
export function useThreadStatus(
  threadId: string | null,
  teamId: string | undefined,
): { title: string | null; status: ThreadStatus } {
  const snapshot = useAgentRuntimeStates().get(threadId ?? '')
  const [title, setTitle] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const status = failed ? 'unavailable' : statusOf(snapshot)
  const active = status === 'running' || status === 'waiting'

  // Once for the title (and the state, if no other view has it yet)…
  useEffect(() => {
    if (!threadId) return
    let cancelled = false

    readThread(threadId, teamId).then(
      (next) => !cancelled && setTitle(next),
      () => !cancelled && setFailed(true),
    )

    return () => {
      cancelled = true
    }
  }, [teamId, threadId])

  // …then again while the thread works, so it turns Done without a reload.
  useEffect(() => {
    if (!threadId || !active) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible')
        void readThread(threadId, teamId).catch(() => null)
    }, ACTIVE_POLL_MS)

    return () => window.clearInterval(timer)
  }, [active, teamId, threadId])

  return { title, status: threadId ? status : 'loading' }
}
