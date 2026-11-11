import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { t } from '../../../i18n'
import { useTeamMembers } from '../../../lib/bindingAccess'
import { canManageTeamTriggers } from '../../../views/triggers/shared'
import { SummarySection } from '../summary/ChatSummaryRows'

import { sortForSchedule } from './bindings'
import { TriggerBindingRow } from './TriggerBindingRow'
import { useBoundTriggers, useMinuteNow } from './useBoundTriggers'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

/**
 * The summary panel's Scheduled block: every Trigger delivering into this
 * conversation. Like the panel's other blocks it appears only when it has one.
 */
export function ScheduledSection({ sessionId, teamId }: { sessionId: string; teamId: string }) {
  const triggers = useBoundTriggers(teamId, [sessionId])

  // Most conversations have no schedule: they render nothing and ask for nothing more.
  return triggers.length > 0 ? <Scheduled teamId={teamId} triggers={triggers} /> : null
}

function Scheduled({ teamId, triggers }: { teamId: string; triggers: AgentTrigger[] }) {
  const now = useMinuteNow()
  const me = useCurrentUser()
  const role = useTeamMembers(teamId).find(
    (member) => member.id === me?.id && !member.removedAt,
  )?.role
  const canManage = canManageTeamTriggers(role)

  return (
    <SummarySection title={t('Scheduled')}>
      {sortForSchedule(triggers, now).map((trigger) => (
        <TriggerBindingRow
          key={trigger.id}
          trigger={trigger}
          teamId={teamId}
          canManage={canManage}
          now={now}
        />
      ))}
    </SummarySection>
  )
}
