import { useMemo } from 'react'

import { isPlanReadyForApproval, planToPayload, planToProgress } from './plan-tool/planData'
import { PlanStatusBadge } from './plan-tool/PlanStatusBadge'
import { PlanTool } from './plan-tool/PlanToolCard'
import { usePlanRetry } from './plan-tool/usePlanRetry'
import { usePlan } from './planUpdates'

import type { Plan } from '../../api'

export { PlanStatusBadge, PlanTool }
export type { CommandStatus } from './plan-tool/planData'

type PlanCardProps = {
  /** The ONLY identity input. Everything rendered is fetched from the API. */
  planId: string
  teamId: string | undefined
  canApprove?: boolean
  canChat?: boolean
  onApprove?: () => Promise<Plan | void> | Plan | void
  onReject?: (reason: string, mode: 'revise' | 'delete') => void
  onChat?: () => void
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
  canApprove,
  canChat,
  onApprove,
  onReject,
  onChat,
  embedded,
  headerAction,
  foldable,
  keepPolling,
  fallback = null,
}: PlanCardProps) {
  const { plan } = usePlan(planId, teamId, { keepPolling })
  const retryState = usePlanRetry(plan, teamId)
  const payload = useMemo(() => (plan ? planToPayload(plan) : null), [plan])
  const progress = useMemo(() => (plan ? planToProgress(plan) : undefined), [plan])

  if (!plan || !payload) return <>{fallback}</>
  const allowApprove = Boolean(
    canApprove && plan.status === 'proposed' && isPlanReadyForApproval(plan),
  )

  return (
    <PlanTool
      key={plan.id}
      payload={payload}
      progress={progress}
      updatedAt={plan.updatedAt}
      status={plan.status}
      approvalProgress={plan.approvalProgress}
      executionError={plan.executionError}
      canApprove={allowApprove}
      canRetry={plan.status === 'failed' && !plan.actions?.length}
      canChat={canChat}
      onApprove={onApprove}
      onReject={onReject}
      onRetry={retryState.retry}
      retrying={retryState.retrying}
      retryError={retryState.retryError}
      onChat={onChat}
      embedded={embedded}
      headerAction={headerAction}
      foldable={foldable}
    />
  )
}
