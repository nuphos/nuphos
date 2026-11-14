import { t } from '../../i18n/index.ts'

import type { AgentTrigger } from '../../api'
import type { TeamMember } from '../../types'

export function stripTrailingSlashes(url: string): string {
  let end = url.length

  while (end > 0 && url[end - 1] === '/') end--

  return url.slice(0, end)
}

export function triggerSourceTitle(trigger: AgentTrigger): string {
  if (trigger.source === 'agent') {
    const sessionId = trigger.sourceContext?.sessionId

    return sessionId
      ? t('Created by the agent in agent {sessionId}', { sessionId })
      : t('Created by the agent')
  }

  return t('Created by automation')
}

export function executionPrincipalLabel(members: TeamMember[], principalId: string): string {
  const principal = members.find((member) => member.id === principalId)

  if (!principal) return principalId
  const name = principal.name || principal.email || principalId

  return principal.removedAt ? t('{name} (removed)', { name }) : name
}

export function triggerPrincipalLabel(members: TeamMember[], trigger: AgentTrigger): string {
  return executionPrincipalLabel(
    members,
    trigger.executionPrincipalUserId ?? trigger.createdByUserId ?? trigger.userId,
  )
}
