import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api'
import { findLatestConversationPlanId } from '../planReference'

type PlanReference = { toolCallId: string; planId: string }

// The list is newest-first and the plan this turn creates is the newest of
// the caller's, so a few rows answer the question. The full page of 50 cost
// ~245 KB every 1.5 s for the whole turn, plan or no plan.
// ponytail: small page instead of a sessionId filter on the route; add the
// filter if a turn's plan can hide behind five newer ones of the same user.
const PLAN_REFERENCE_PAGE_SIZE = 5

/**
 * Recover a native-skill Plan from durable storage when its best-effort live
 * tool frame was dropped during a transcript refresh.
 */
export function useConversationPlanReference(
  sessionId: string | undefined,
  streaming: boolean,
  teamId: string | undefined,
  liveReference: PlanReference | null,
): PlanReference | null {
  const [durable, setDurable] = useState<{ sessionId: string; planId: string } | null>(null)
  const livePlanId = liveReference?.planId

  useEffect(() => {
    if (!sessionId || !teamId || livePlanId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const page = await api.agentListPlans({
          teamId,
          mine: true,
          limit: PLAN_REFERENCE_PAGE_SIZE,
        })
        const planId = findLatestConversationPlanId(page.plans, sessionId)

        if (cancelled) return
        if (planId) {
          setDurable({ sessionId, planId })

          return
        }
      } catch {
        // A transient list failure must not affect the chat stream. Retry only
        // while the owning turn can still be creating its Plan.
      }
      if (!cancelled && streaming)
        timer = setTimeout(() => {
          void tick()
        }, 1500)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [livePlanId, sessionId, streaming, teamId])

  return useMemo(() => {
    if (liveReference) return liveReference
    if (!durable || durable.sessionId !== sessionId) return null

    return {
      toolCallId: `durable-plan-${durable.planId}`,
      planId: durable.planId,
    }
  }, [durable, liveReference, sessionId])
}
