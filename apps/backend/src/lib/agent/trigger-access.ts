import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import { readsConversation } from './db/access'

import type { AgentCredentialAccess } from './db'
import type { TriggerCredentialMode } from './trigger-credential-access'

/** Every level above `read` belongs to the owner of the Trigger's Task. */
export type TriggerAccessLevel = 'read' | 'manage' | 'delete'

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

/**
 * A Trigger has no owner of its own: it belongs to one Task. `userId` is that
 * Task's owner, copied when the Trigger is created in it. The copy stays true
 * because a Trigger never moves to another Task and a Task's owner never
 * changes.
 */
export type TeamOwnedTriggerResource = {
  userId: string
  teamId?: string
  /** The Task the Trigger delivers into; who may read it follows that Task. */
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

/** Every change belongs to the owner of the Trigger's Task. */
export function canManageTrigger(resource: TeamOwnedTriggerResource, userId: string): boolean {
  return resource.userId === userId
}

/** Whoever may read the Trigger's Task may read the Trigger. */
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
 * Reading follows the Trigger's Task and every change is the Task owner's. A
 * team role grants nothing here.
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
      'Only the owner of the Task this Trigger belongs to can change it',
    )
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
