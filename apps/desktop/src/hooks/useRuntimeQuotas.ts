import { useEffect, useState } from 'react'

import { api } from '../api.ts'

import { RUNTIME_INSTANCES_CHANGED } from './useRuntimeInstances.ts'

import type { RuntimeInstance, RuntimeQuota } from '../types/runtime'

/** Matches the backend's shorter hold, not its longer one: an offline agent, a
 *  timeout or a sign-in prompt is held thirty seconds there, so an agent that
 *  comes back has to be visible in that order of time. A provider's own answer
 *  is held ten minutes, so this tick never reaches Anthropic or ChatGPT more
 *  often than that. */
const QUOTA_POLL_MS = 30_000
const EMPTY: ReadonlyMap<string, RuntimeQuota> = new Map()

export function useRuntimeQuotas(
  teamId?: string,
  instances: readonly RuntimeInstance[] = [],
): ReadonlyMap<string, RuntimeQuota> {
  // Presence and the first usage reading can arrive after the initial quota request.
  const presenceKey = JSON.stringify(instances.map(({ id, local }) => [id, local?.usageAt]))
  const [state, setState] = useState<{
    teamId?: string
    quotas: ReadonlyMap<string, RuntimeQuota>
  }>({ quotas: EMPTY })

  useEffect(() => {
    if (!teamId) return
    let cancelled = false
    let request = 0
    const load = async () => {
      const current = ++request

      try {
        const quotas = await api.atlasListRuntimeQuotas(teamId)

        if (cancelled || current !== request) return
        setState({ teamId, quotas: new Map(quotas.map((quota) => [quota.runtimeId, quota])) })
      } catch {
        /* Quota is decoration; keep whatever was shown before. */
      }
    }
    const refresh = () => {
      void load()
    }

    refresh()
    // One backstop tick per backend hold, so a settings page left open does not
    // freeze at its first reading. Anything asked inside the hold is served
    // from the backend's cache, so the provider is still asked once per ten
    // minutes however many clients are watching.
    const timer = setInterval(refresh, QUOTA_POLL_MS)

    window.addEventListener(RUNTIME_INSTANCES_CHANGED, refresh)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(RUNTIME_INSTANCES_CHANGED, refresh)
    }
  }, [teamId, presenceKey])

  return state.teamId === teamId ? state.quotas : EMPTY
}
