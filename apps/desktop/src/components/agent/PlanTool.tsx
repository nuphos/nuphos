import { useMemo } from 'react'

import { planToPayload, planToProgress } from './plan-tool/planData'
import { PlanStatusBadge } from './plan-tool/PlanStatusBadge'
import { PlanTool } from './plan-tool/PlanToolCard'
import { usePlan } from './planUpdates'

export { PlanStatusBadge, PlanTool }
export type { CommandStatus } from './plan-tool/planData'

type PlanCardProps = {
  /** The ONLY identity input. Everything rendered is fetched from the API. */
  planId: string
  teamId: string | undefined
  embedded?: boolean
  headerAction?: React.ReactNode
  foldable?: boolean
  keepPolling?: boolean
  /** Rendered while the plan doc hasn't loaded yet. */
  fallback?: React.ReactNode
}

/**
 * Plan card that takes only a planId and pulls the rest from the plan API.
 * This is the canonical way to render a persisted plan anywhere in the app —
 * the message stream never carries plan content, only the id.
 */
export function PlanCard({
  planId,
  teamId,
  embedded,
  headerAction,
  foldable,
  keepPolling,
  fallback = null,
}: PlanCardProps) {
  const { plan } = usePlan(planId, teamId, { keepPolling })
  const payload = useMemo(() => (plan ? planToPayload(plan) : null), [plan])
  const progress = useMemo(() => (plan ? planToProgress(plan) : undefined), [plan])

  if (!plan || !payload) return <>{fallback}</>

  return (
    <PlanTool
      key={plan.id}
      payload={payload}
      progress={progress}
      status={plan.status}
      executionError={plan.executionError}
      embedded={embedded}
      headerAction={headerAction}
      foldable={foldable}
    />
  )
}
