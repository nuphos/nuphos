import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { getConversation } from '../db'
import { credentialScopeCoversAll } from '../trigger-credential-access'
import { agentTriggers } from '../trigger-db'
import { agentTriggerGroups } from '../trigger-group-db'

import { standaloneTriggerFilter } from './shared'

import type { TriggerActorContext } from '../trigger-access'
import type { TriggerCredentialSelection } from '../trigger-credential-access'
import type { TriggerCallerContext } from './shared'

/**
 * How a new Trigger binds credentials. A caller that names a scope gets
 * `selected`; everyone else gets `all`, so the Trigger keeps following the
 * team's connectors instead of freezing today's list.
 *
 * The originating Agent session sits in between: its approved scope bounds
 * what a Trigger it spawns may reach, but only when the user actually
 * narrowed that session. A session holding everything the principal can
 * reach expresses no preference, so it yields `all`.
 *
 * `@/routes/agent` is imported lazily because it transitively imports this
 * module — a static edge here would close an initialization cycle.
 */
export async function resolveTriggerCredentialSelection(
  context: TriggerCallerContext | TriggerActorContext,
): Promise<TriggerCredentialSelection> {
  if (context.credentialMode === 'all') return { credentialMode: 'all' }
  if (context.credentialAccess) {
    return { credentialMode: 'selected', executionCredentialAccess: context.credentialAccess }
  }
  const sessionId =
    context.sessionId ?? ('sourceContext' in context ? context.sourceContext?.sessionId : undefined)

  if (!sessionId) return { credentialMode: 'all' }
  const approved = (await getConversation(sessionId, context.userId, context.teamId))
    ?.credentialAccess

  if (!approved) return { credentialMode: 'all' }
  const { resolveTriggerCredentialAccess } = await import('@/routes/agent')
  const current = await resolveTriggerCredentialAccess(context.teamId, context.userId)

  return credentialScopeCoversAll(approved, current)
    ? { credentialMode: 'all' }
    : { credentialMode: 'selected', executionCredentialAccess: approved }
}

/** One standalone Trigger or one Watch Group consumes one quota slot. */
export async function assertTriggerCreationQuota(context: TriggerActorContext): Promise<void> {
  if (!context.teamId) {
    const personalCount = await agentTriggers().countDocuments({
      userId: context.userId,
      teamId: { $exists: false },
      enabled: true,
      ...standaloneTriggerFilter(),
    })

    if (personalCount >= config.agent.triggers.maxPerOwner) {
      throw new AppError(
        429,
        'trigger_quota_exceeded',
        `Your enabled Trigger limit is ${String(config.agent.triggers.maxPerOwner)}. Disable or remove one first.`,
      )
    }

    return
  }

  const actorOwnership = {
    $or: [
      { createdByUserId: context.userId },
      {
        createdByUserId: { $exists: false },
        userId: context.userId,
      },
    ],
  }
  const [actorTriggers, actorGroups, teamTriggers, teamGroups] = await Promise.all([
    agentTriggers().countDocuments({
      teamId: context.teamId,
      enabled: true,
      ...standaloneTriggerFilter(),
      ...actorOwnership,
    }),
    agentTriggerGroups().countDocuments({
      teamId: context.teamId,
      enabled: true,
      ...actorOwnership,
    }),
    agentTriggers().countDocuments({
      teamId: context.teamId,
      enabled: true,
      ...standaloneTriggerFilter(),
    }),
    agentTriggerGroups().countDocuments({
      teamId: context.teamId,
      enabled: true,
    }),
  ])

  if (actorTriggers + actorGroups >= config.agent.triggers.maxPerOwner) {
    throw new AppError(
      429,
      'trigger_quota_exceeded',
      `Each team member may own up to ${String(config.agent.triggers.maxPerOwner)} enabled Triggers or Watch Groups.`,
    )
  }
  if (teamTriggers + teamGroups >= config.agent.triggers.maxPerTeam) {
    throw new AppError(
      429,
      'team_trigger_quota_exceeded',
      `This team may have up to ${String(config.agent.triggers.maxPerTeam)} enabled Triggers or Watch Groups.`,
    )
  }
}
