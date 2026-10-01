import { useEffect, useState } from 'react'

import { newestRuntimeSnapshot } from '../../lib/runtimeExecution'

import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

/** The newest observation for a row, re-rendered each second so a stale one stops counting. */
export function useRuntimeObservation(
  conversation: AgentConversation,
  runtimeState: RuntimeExecution | undefined,
): RuntimeExecution | undefined {
  const state = newestRuntimeSnapshot(conversation.runtimeState, runtimeState)
  const [, tick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000)

    return () => window.clearInterval(timer)
  }, [state])

  return state
}
