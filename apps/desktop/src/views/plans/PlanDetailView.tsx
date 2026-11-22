import { MessageSquare } from 'lucide-react'
import { useMemo } from 'react'

import { planToPayload, planToProgress } from '../../components/agent/plan-tool/planData'
import { PlanTool } from '../../components/agent/PlanTool'
import { usePlan } from '../../components/agent/planUpdates'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

type Props = {
  teamId: string
  planId: string
  onOpenInChat?: (planId: string) => void
}

export function PlanDetailView({ teamId, planId, onOpenInChat }: Props) {
  const { plan, loading } = usePlan(planId, teamId)
  const payload = useMemo(() => (plan ? planToPayload(plan) : null), [plan])
  const progress = useMemo(() => (plan ? planToProgress(plan) : []), [plan])

  const openChatAction =
    plan && onOpenInChat && (plan.status === 'proposed' || plan.status === 'approved') ? (
      <Button
        variant="ghost"
        onClick={() => onOpenInChat(plan.id)}
        className="h-7 gap-1.5 px-2 text-[12.5px]"
      >
        <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
        {plan.status === 'proposed' ? t('Continue in the task') : t('Open in a task')}
      </Button>
    ) : undefined

  return (
    <div className="min-h-0 flex-1">
      <div className="mx-auto h-full w-full max-w-[1120px] border-x border-line-control/40">
        {plan && payload ? (
          <PlanTool
            key={plan.id}
            payload={payload}
            progress={progress}
            status={plan.status}
            executionError={plan.executionError}
            embedded
            headerAction={openChatAction}
          />
        ) : (
          <div className="px-6 py-5 text-[12.5px] text-tertiary">
            {loading ? t('Loading plan…') : t('Plan not found.')}
          </div>
        )}
      </div>
    </div>
  )
}
