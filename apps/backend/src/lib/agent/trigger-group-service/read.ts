import { AppError } from '@/lib/errors'

import { assertTriggerAccess } from '../trigger-access'
import { agentTriggerGroups, isSharedIngressTriggerGroup } from '../trigger-group-db'

import { loadPartitionTriggers, parseGroupId, serializeTriggerGroup } from './shared'

import type { TriggerAccessLevel, TriggerActorContext } from '../trigger-access'
import type { AgentTriggerGroup } from '../trigger-group-db'
import type { SerializedTriggerGroup } from './shared'

export async function listTriggerGroups(scope: {
  userId: string
  teamId?: string
}): Promise<SerializedTriggerGroup[]> {
  if (!scope.teamId) return []
  const groups = await agentTriggerGroups()
    .find({ teamId: scope.teamId })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray()

  return Promise.all(
    groups
      .filter(isSharedIngressTriggerGroup)
      .map(async (group) => serializeTriggerGroup(group, await loadPartitionTriggers(group))),
  )
}

export async function getOwnedTriggerGroup(
  groupId: string,
  context: TriggerActorContext,
  access: TriggerAccessLevel = 'read',
): Promise<AgentTriggerGroup> {
  if (!context.teamId) {
    throw new AppError(400, 'trigger_group_team_required', 'A team is required')
  }
  const group = await agentTriggerGroups().findOne({ _id: parseGroupId(groupId) })

  if (!isSharedIngressTriggerGroup(group)) {
    throw new AppError(404, 'trigger_group_not_found', 'Watch Group not found')
  }
  await assertTriggerAccess(group, context, access)

  return group
}
