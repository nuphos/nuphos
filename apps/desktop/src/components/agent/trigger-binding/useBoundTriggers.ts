import { useEffect, useMemo, useState } from 'react'

import { triggersForSessions } from './bindings'
import { useTriggerBindings } from './bindingStore'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

// Next runs move on as time passes; a minute is as fine as they are shown.
export function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)

    return () => window.clearInterval(timer)
  }, [])

  return now
}

/** The Triggers bound to these conversations: a chat's own, and a Bot chat's Bot. */
export function useBoundTriggers(
  teamId: string | undefined,
  sessionIds: readonly (string | null | undefined)[],
): AgentTrigger[] {
  const map = useTriggerBindings(teamId)
  const key = sessionIds.filter(Boolean).join(',')

  return useMemo(() => triggersForSessions(map, key.split(',')), [map, key])
}
