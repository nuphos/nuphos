import { ClipboardList } from 'lucide-react'

import { EmptyState } from '../components/EmptyState'
import { t } from '../i18n'
import { planNumberFromFilter } from '../lib/planRoute'

import { PlanDetailView } from './plans/PlanDetailView'

type Props = {
  teamId: string
  /** A Plan deep link (/teams/T/plans/<number>) lands here as the bare plan number. */
  filter?: string
  /** Open a plan in the agent chat (surfaces it in the chat's side panel). */
  onOpenInChat?: (planId: string) => void
}

/** One Plan, opened from a link. Agents now ask for approval in the Inbox, so there is no list. */
export function PlansView({ teamId, filter = '', onOpenInChat }: Props) {
  const planNumber = planNumberFromFilter(filter)

  if (planNumber) {
    return <PlanDetailView teamId={teamId} planId={planNumber} onOpenInChat={onOpenInChat} />
  }

  return (
    <EmptyState
      icon={ClipboardList}
      title={t('Plans')}
      description={t('Agents now ask for approval in the Inbox.')}
    />
  )
}
