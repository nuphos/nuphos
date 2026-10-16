import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { isNetworkError } from '../../../api/errors'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

// Last read per trigger, so a remounted card shows it at once while it re-reads.
const lastRead = new Map<string, AgentTrigger>()

/** The trigger as it is now: read on mount and whenever the window regains focus. */
export function useTrigger(triggerId: string | null, teamId: string | undefined) {
  const [trigger, setTriggerState] = useState<AgentTrigger | null>(
    () => (triggerId ? lastRead.get(triggerId) : undefined) ?? null,
  )
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!triggerId) return
    let cancelled = false
    const read = () => {
      void api.agentGetTrigger(triggerId, teamId).then(
        (next) => {
          if (cancelled) return
          lastRead.set(triggerId, next)
          setTriggerState(next)
          setMissing(false)
        },
        (err: unknown) => {
          // Offline keeps the last read; an answer from the backend (not found,
          // no access) means the trigger is gone for this viewer.
          if (cancelled || isNetworkError(err)) return
          lastRead.delete(triggerId)
          setTriggerState(null)
          setMissing(true)
        },
      )
    }

    read()
    window.addEventListener('focus', read)

    return () => {
      cancelled = true
      window.removeEventListener('focus', read)
    }
  }, [teamId, triggerId])

  const setTrigger = (next: AgentTrigger) => {
    lastRead.set(next.id, next)
    setTriggerState(next)
  }

  return { trigger, missing, setTrigger }
}
