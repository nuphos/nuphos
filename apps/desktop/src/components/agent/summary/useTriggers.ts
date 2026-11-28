import { useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { nextOccurrencesAfter } from '../../../views/triggers/calendar/occurrences'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

/** A conversation's Triggers, refreshed every 30 seconds, and a switch that applies at once. */
export function useTriggers(teamId: string, sessionId: string) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const mounted = useRef(true)
  const revision = useRef(0)
  const updating = useRef(new Set<string>())

  useEffect(() => {
    mounted.current = true
    let active = true
    let timer: ReturnType<typeof setTimeout>

    async function refresh() {
      try {
        const requestedRevision = revision.current
        const rows = await api.agentListTriggers(teamId, sessionId)

        if (active && requestedRevision === revision.current && updating.current.size === 0) {
          setTriggers(rows)
          setLoaded(true)
          setError(false)
        }
      } catch {
        if (active) setError(true)
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 30_000)
      }
    }
    void refresh()

    return () => {
      active = false
      mounted.current = false
      clearTimeout(timer)
    }
  }, [teamId, sessionId])

  async function toggle(trigger: AgentTrigger, enabled: boolean) {
    if (updating.current.has(trigger.id)) return
    revision.current++
    updating.current.add(trigger.id)
    setPending(new Set(updating.current))
    try {
      const updated = await api.agentUpdateTrigger(trigger.id, { enabled }, teamId)

      if (mounted.current) {
        setTriggers((current) =>
          current.map((row) =>
            row.id === trigger.id
              ? {
                  ...row,
                  enabled: updated.enabled,
                  // A person changed it: no reason Nuphos paused it for still applies.
                  executionAuthorizationError: undefined,
                  nextRunAt:
                    enabled && row.triggerType === 'cron'
                      ? nextOccurrencesAfter(
                          row.cronExpression ?? '',
                          new Date(),
                          1,
                          row.timeZone,
                        )[0]?.toISOString()
                      : null,
                }
              : row,
          ),
        )
        setError(false)
      }
    } catch {
      if (mounted.current) setError(true)
    } finally {
      revision.current++
      updating.current.delete(trigger.id)
      if (mounted.current) setPending(new Set(updating.current))
    }
  }

  return { triggers, loaded, error, pending, toggle }
}
