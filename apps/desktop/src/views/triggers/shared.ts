import { toast } from '../../components/ui/toast'

import type { AgentTrigger } from '../../api'
import type { TeamMember, TeamRole } from '../../types'

export function stripTrailingSlashes(url: string): string {
  let end = url.length

  while (end > 0 && url[end - 1] === '/') end--

  return url.slice(0, end)
}

export function triggerSourceTitle(trigger: AgentTrigger): string {
  if (trigger.source === 'agent') {
    const sessionId = trigger.sourceContext?.sessionId
    const where = sessionId ? ` in session ${sessionId}` : ''

    return `Created by the agent${where}`
  }

  return 'Created by automation'
}

export function reportCleanupFailures(triggers: AgentTrigger[]) {
  for (const trigger of triggers) {
    if (trigger.cleanupStatus === 'cleanup_failed') {
      toast.error(
        `Could not remove ${trigger.name}`,
        trigger.cleanupError ?? 'Provider cleanup did not finish. Retry from the trigger details.',
      )
    }
  }
}

export function canManageTeamTriggers(role: TeamRole | undefined): boolean {
  return role === 'ADMINISTRATOR' || role === 'EDITOR'
}

export function canDeleteTeamTriggers(role: TeamRole | undefined): boolean {
  return role === 'ADMINISTRATOR'
}

export function executionPrincipalLabel(members: TeamMember[], principalId: string): string {
  const principal = members.find((member) => member.id === principalId)

  if (!principal) return principalId
  const name = principal.name || principal.email || principalId

  return principal.removedAt ? `${name} (removed)` : name
}

export function triggerPrincipalLabel(members: TeamMember[], trigger: AgentTrigger): string {
  return executionPrincipalLabel(
    members,
    trigger.executionPrincipalUserId ?? trigger.createdByUserId ?? trigger.userId,
  )
}
