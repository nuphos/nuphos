import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import { readsConversation } from './db/access'

import type { AgentCredentialAccess } from './db'
import type { TriggerCredentialMode } from './trigger-credential-access'

/** Every level above `read` belongs to the Trigger's owner alone. */
export type TriggerAccessLevel = 'read' | 'manage' | 'transfer' | 'delete'

export type TriggerActorContext = {
  userId: string
  teamId?: string
  /** Credential scope explicitly approved by the actor's current Agent session. */
  credentialAccess?: AgentCredentialAccess
  /** Set to 'all' to bind the new row to the team's credentials as they stand at each run. */
  credentialMode?: TriggerCredentialMode
  /**
   * Agent session the mutation originates from. Used to recover the approved
   * credential scope when the caller did not pass it explicitly, so Agent
   * tools and HTTP routes resolve execution scope through one path.
   */
  sessionId?: string
}

export type TriggerActor = string | TriggerActorContext

export type TeamOwnedTriggerResource = {
  userId: string
  teamId?: string
  createdByUserId?: string
  executionPrincipalUserId?: string
  /** The conversation the Trigger delivers into; who may read it follows that conversation. */
  targetSessionId?: string
}

export async function assertTeamMember(actor: TriggerActorContext) {
  const membership = actor.teamId ? await getTeamMembership(actor.userId, actor.teamId) : null

  if (!membership) {
    throw new AppError(404, 'not_found', 'Trigger not found')
  }

  return membership
}

/**
 * Creating a Trigger is the one check left on the team role: a viewer may not
 * start recurring agent work. Everything after creation follows the
 * conversation the Trigger belongs to.
 */
export async function assertCanCreateTrigger(actor: TriggerActorContext): Promise<void> {
  if (!actor.teamId) return
  if ((await assertTeamMember(actor)).role === 'VIEWER') {
    throw new AppError(403, 'trigger_access_denied', 'Your team role cannot create triggers')
  }
}

/** Every change belongs to the Trigger's owner, who also owns its conversation. */
export function canManageTrigger(resource: TeamOwnedTriggerResource, userId: string): boolean {
  return triggerExecutionPrincipalId(resource) === userId
}

/**
 * Whoever may read the Trigger's conversation may read the Trigger. One whose
 * conversation is gone is readable by its owner alone.
 */
export async function readsTriggerConversation(
  resource: TeamOwnedTriggerResource,
  userId: string,
): Promise<boolean> {
  if (canManageTrigger(resource, userId)) return true
  if (!resource.targetSessionId) return false
  const conversation = await getConversationBySessionId(resource.targetSessionId)

  return Boolean(
    conversation &&
      conversation.teamId === resource.teamId &&
      readsConversation(conversation, userId),
  )
}

/**
 * Reading follows the Trigger's conversation and every change is its owner's.
 * A team role grants nothing here.
 */
export async function assertTriggerAccess(
  resource: TeamOwnedTriggerResource,
  actor: TriggerActor,
  level: TriggerAccessLevel,
): Promise<void> {
  const actorContext = typeof actor === 'string' ? { userId: actor } : actor

  if (!resource.teamId) {
    if (resource.userId !== actorContext.userId) {
      throw new AppError(404, 'not_found', 'Trigger not found')
    }

    return
  }
  // Internal callers pass only a user id and act on that user's behalf.
  if (typeof actor !== 'string') {
    if (actor.teamId !== resource.teamId) {
      throw new AppError(404, 'not_found', 'Trigger not found')
    }
    await assertTeamMember(actor)
  }
  if (!(await readsTriggerConversation(resource, actorContext.userId))) {
    throw new AppError(404, 'not_found', 'Trigger not found')
  }
  if (level !== 'read' && !canManageTrigger(resource, actorContext.userId)) {
    throw new AppError(
      403,
      'trigger_access_denied',
      'Only the owner of the conversation this Trigger belongs to can change it',
    )
  }
}

export function triggerCreatedByUserId(resource: TeamOwnedTriggerResource): string {
  return resource.createdByUserId ?? resource.userId
}

export function triggerExecutionPrincipalId(resource: TeamOwnedTriggerResource): string {
  return resource.executionPrincipalUserId ?? resource.createdByUserId ?? resource.userId
}

/**
 * Mongo selector matching exactly the rows whose execution principal is this
 * user, including legacy rows that predate the explicit fields. It must stay
 * in lockstep with triggerExecutionPrincipalId: anything that function would
 * resolve to `principalUserId` has to match here, and nothing else may.
 */
export function triggerExecutionPrincipalFilter(principalUserId: string): {
  $or: Record<string, string | { $exists: boolean }>[]
} {
  return {
    $or: [
      { executionPrincipalUserId: principalUserId },
      {
        executionPrincipalUserId: { $exists: false },
        createdByUserId: principalUserId,
      },
      {
        executionPrincipalUserId: { $exists: false },
        createdByUserId: { $exists: false },
        userId: principalUserId,
      },
    ],
  }
}

/**
 * Whether the stored authorization already says "verified and healthy". A run
 * that finds this true writes nothing, so routine executions never touch
 * `updatedAt` — which everywhere else means "the configuration changed".
 */
export function executionAuthorizationIsCurrent(resource: {
  executionAuthorizationStatus?: string
  executionAuthorizationError?: string
}): boolean {
  return resource.executionAuthorizationStatus === 'valid' && !resource.executionAuthorizationError
}

/**
 * Whether a Watch Group as a whole may be reported healthy.
 *
 * Only an ingress that has actually proven itself counts as passing. One that
 * has never run is unverified, not healthy — it may be the one whose principal
 * lost access.
 *
 * Being disabled excuses an ingress only when it was switched off deliberately.
 * A recorded failure always blocks, because the system disables an ingress
 * precisely when its execution identity breaks: treating that as "switched off,
 * so ignore it" would let the very failure that paused it turn the Group green
 * again as soon as a sibling ran.
 */
export function triggerGroupExecutionIsHealthy(
  partitions: { enabled: boolean; executionAuthorizationStatus?: string }[],
): boolean {
  return partitions.every((partition) => {
    if (partition.executionAuthorizationStatus === 'invalid') return false

    return !partition.enabled || partition.executionAuthorizationStatus === 'valid'
  })
}
