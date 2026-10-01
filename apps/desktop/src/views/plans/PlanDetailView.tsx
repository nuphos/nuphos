import { MessageSquare } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { api } from '../../api'
import {
  isPlanReadyForApproval,
  planToPayload,
  planToProgress,
} from '../../components/agent/plan-tool/planData'
import { usePlanRetry } from '../../components/agent/plan-tool/usePlanRetry'
import { PlanTool } from '../../components/agent/PlanTool'
import { emitPlanUpdated, usePlan } from '../../components/agent/planUpdates'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import type { Plan } from '../../api'

type Props = {
  teamId: string
  planId: string
  onOpenInChat?: (planId: string) => void
}

export function PlanDetailView({ teamId, planId, onOpenInChat }: Props) {
  const { plan, loading } = usePlan(planId, teamId)
  const retryState = usePlanRetry(plan, teamId)
  const payload = useMemo(() => (plan ? planToPayload(plan) : null), [plan])
  const progress = useMemo(() => (plan ? planToProgress(plan) : []), [plan])

  const approvePlan = useCallback(async (): Promise<Plan | void> => {
    if (!plan) return
    const previousApprovalCount = plan.approvals.length

    try {
      const updated = await api.agentUpdatePlan(plan.id, { status: 'approved' }, teamId)

      emitPlanUpdated(updated)

      if (updated.status === 'approved') {
        toast.success('Plan approved', 'The approval gate is complete.')
      } else if (updated.approvals.length === previousApprovalCount) {
        toast.success('Approval already recorded', 'Your vote is already included in this plan.')
      } else {
        const remaining = Math.max(
          0,
          Number(
            updated.approvalProgress.requesterApprovalRequired &&
              !updated.approvalProgress.requesterApproved,
          ) +
            updated.approvalProgress.minimumOtherApprovals -
            updated.approvalProgress.otherApprovals,
        )

        toast.success(
          'Approval recorded',
          `${String(remaining)} required approval${remaining === 1 ? '' : 's'} remaining.`,
        )
      }

      return updated
    } catch (err) {
      toast.apiError('Could not approve plan', err, {
        fallback: 'The plan was not approved. Please try again.',
      })
      throw err
    }
  }, [plan, teamId])

  const openChatAction =
    plan && onOpenInChat && (plan.status === 'proposed' || plan.status === 'approved') ? (
      <Button
        variant="ghost"
        onClick={() => onOpenInChat(plan.id)}
        className="h-7 gap-1.5 px-2 text-[12.5px]"
      >
        <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
        {plan.status === 'proposed' ? 'Continue in chat' : 'Open in chat'}
      </Button>
    ) : undefined

  return (
    <div className="min-h-0 flex-1">
      <div className="mx-auto h-full w-full max-w-[1120px] border-x border-zGray-800/40">
        {plan && payload ? (
          <PlanTool
            key={plan.id}
            payload={payload}
            progress={progress}
            updatedAt={plan.updatedAt}
            status={plan.status}
            approvalProgress={plan.approvalProgress}
            executionError={plan.executionError}
            canApprove={plan.status === 'proposed' && isPlanReadyForApproval(plan)}
            canRetry={plan.status === 'failed' && !plan.actions?.length}
            onApprove={approvePlan}
            onRetry={retryState.retry}
            retrying={retryState.retrying}
            retryError={retryState.retryError}
            embedded
            headerAction={openChatAction}
          />
        ) : (
          <div className="px-6 py-5 text-[12.5px] text-tertiary">
            {loading ? 'Loading plan…' : 'Plan not found.'}
          </div>
        )}
      </div>
    </div>
  )
}
