import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import type { AgentCredentialAccess } from './db'
import type { TriggerCredentialMode } from './trigger-credential-access'
import type { NuphosTeamRole } from '@/lib/identity'

/**
 * `transfer` moves a Trigger's execution identity. It sits at the same height
 * as `delete` because it is the one operation that changes whose authority a
 * Trigger runs with — deliberately separate from `manage`, so that editing can
 * never promote a Trigger to its editor's permissions as a side effect.
 */
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
}

function requiredRoles(level: TriggerAccessLevel): NuphosTeamRole[] {
  if (level === 'read') return ['VIEWER', 'EDITOR', 'ADMINISTRATOR']
  if (level === 'manage') return ['EDITOR', 'ADMINISTRATOR']

  return ['ADMINISTRATOR']
}

export function canAccessTeamTrigger(role: NuphosTeamRole, level: TriggerAccessLevel): boolean {
  return requiredRoles(level).includes(role)
}

const TEAM_ROLE_RANK: Record<NuphosTeamRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMINISTRATOR: 2,
}

export function canModifyTriggerExecution(
  actorUserId: string,
  actorRole: NuphosTeamRole,
  principalUserId: string,
  principalRole: NuphosTeamRole | undefined,
): boolean {
  if (actorUserId === principalUserId) return true
  // A departed principal is a broken execution identity. Only an administrator
  // may repair/rebind it; an editor must not inherit that principal's former
  // authority merely because their membership no longer resolves.
  if (!principalRole) return actorRole === 'ADMINISTRATOR'

  return TEAM_ROLE_RANK[actorRole] >= TEAM_ROLE_RANK[principalRole]
}

export async function assertTeamTriggerRole(
  actor: TriggerActorContext,
  level: TriggerAccessLevel,
): Promise<void> {
  if (!actor.teamId) return
  const membership = await getTeamMembership(actor.userId, actor.teamId)

  if (!membership) {
    throw new AppError(404, 'not_found', 'Trigger not found')
  }
  if (!canAccessTeamTrigger(membership.role, level)) {
    throw new AppError(
      403,
      'trigger_access_denied',
      level === 'delete'
        ? 'Only team administrators can remove team triggers'
        : level === 'transfer'
          ? 'Only team administrators can transfer who a Trigger runs as'
          : 'Your team role cannot modify triggers',
    )
  }
}

export async function assertTriggerAccess(
  resource: TeamOwnedTriggerResource,
  actor: TriggerActor,
  level: TriggerAccessLevel,
): Promise<void> {
  // Internal callers historically pass only the owner id. Preserve that
  // narrow capability while the public HTTP surface always passes a team
  // context and receives role-based access.
  if (typeof actor === 'string') {
    if (resource.userId !== actor) {
      throw new AppError(404, 'not_found', 'Trigger not found')
    }

    return
  }

  if (!resource.teamId) {
    if (resource.userId !== actor.userId) {
      throw new AppError(404, 'not_found', 'Trigger not found')
    }

    return
  }
  if (!actor.teamId || actor.teamId !== resource.teamId) {
    throw new AppError(404, 'not_found', 'Trigger not found')
  }
  await assertTeamTriggerRole(actor, level)
}

/**
 * Execution-affecting edits are stricter than ordinary management: the actor
 * must be the current principal or hold a team role at least as privileged.
 *
 * The edit does not move the execution identity — only an explicit `transfer`
 * does — so this guard exists because the edited instructions will run with
 * the *existing* principal's authority. Without it, an Editor could have an
 * Administrator's identity execute whatever they wrote.
 */
export async function assertTriggerExecutionMutationAccess(
  resource: TeamOwnedTriggerResource,
  actor: TriggerActor,
): Promise<void> {
  await assertTriggerAccess(resource, actor, 'manage')
  if (typeof actor === 'string' || !resource.teamId) return

  const principalUserId = triggerExecutionPrincipalId(resource)
  const [actorMembership, principalMembership] = await Promise.all([
    getTeamMembership(actor.userId, resource.teamId),
    actor.userId === principalUserId
      ? Promise.resolve(undefined)
      : getTeamMembership(principalUserId, resource.teamId),
  ])

  if (
    !actorMembership ||
    !canModifyTriggerExecution(
      actor.userId,
      actorMembership.role,
      principalUserId,
      principalMembership?.role,
    )
  ) {
    throw new AppError(
      403,
      'trigger_execution_access_denied',
      'Your team role is lower than this Trigger execution principal',
    )
  }
}

export async function canManageTrigger(
  resource: TeamOwnedTriggerResource,
  actor: TriggerActor,
): Promise<boolean> {
  if (typeof actor === 'string') return resource.userId === actor
  if (!resource.teamId) return resource.userId === actor.userId
  if (!actor.teamId || actor.teamId !== resource.teamId) return false
  const membership = await getTeamMembership(actor.userId, actor.teamId)

  return Boolean(membership && canAccessTeamTrigger(membership.role, 'manage'))
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
