import { useEffect, useState } from 'react'

import { api } from '../api'

import { RUNTIME_INSTANCES_CHANGED } from './useRuntimeInstances'

import type { RuntimeQuota } from '../types/runtime'

const QUOTA_POLL_MS = 60_000
const EMPTY: ReadonlyMap<string, RuntimeQuota> = new Map()

export function useRuntimeQuotas(teamId?: string): ReadonlyMap<string, RuntimeQuota> {
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
    const timer = setInterval(refresh, QUOTA_POLL_MS)

    window.addEventListener(RUNTIME_INSTANCES_CHANGED, refresh)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(RUNTIME_INSTANCES_CHANGED, refresh)
    }
  }, [teamId])

  return state.teamId === teamId ? state.quotas : EMPTY
}
