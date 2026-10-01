import { useCallback, useState } from 'react'

import { api, parseAtlasError } from '../../../api'
import { emitPlanUpdated } from '../planUpdates'

import type { Plan } from '../../../api'

export function usePlanRetry(plan: Plan | null, teamId: string | undefined) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const retry = useCallback(() => {
    if (!plan || retrying) return
    setRetrying(true)
    setRetryError(null)
    void (async () => {
      try {
        const next = await api.agentRetryPlan(plan.id, teamId)

        emitPlanUpdated(next)
      } catch (err) {
        setRetryError(parseAtlasError(err).message)
      } finally {
        setRetrying(false)
      }
    })()
  }, [plan, retrying, teamId])

  return { retry, retrying, retryError }
}
