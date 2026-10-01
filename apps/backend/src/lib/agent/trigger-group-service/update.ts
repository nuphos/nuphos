import { AppError } from '@/lib/errors'

import { assertTriggerExecutionMutationAccess } from '../trigger-access'
import { agentTriggerGroups } from '../trigger-group-db'
import { updateTrigger } from '../trigger-service'

import { getOwnedTriggerGroup } from './read'
import { loadPartitionTriggers, serializeTriggerGroup } from './shared'

import type { TriggerActorContext } from '../trigger-access'
import type { AgentTriggerGroup } from '../trigger-group-db'
import type { SerializedTriggerGroup, UpdateTriggerGroupInput } from './shared'

/**
 * Update the user-facing Group configuration and keep every shared provider
 * ingress on the same prompt. Individual trigger updates remain untouched;
 * this is the Group-only synchronization boundary.
 */
export async function updateTriggerGroup(
  groupId: string,
  context: TriggerActorContext,
  patch: UpdateTriggerGroupInput,
): Promise<SerializedTriggerGroup> {
  const group = await getOwnedTriggerGroup(groupId, context, 'manage')
  const triggers = await loadPartitionTriggers(group)

  if (triggers.length !== group.partitions.length) {
    throw new AppError(
      409,
      'trigger_group_incomplete',
      'One or more Watch Group ingresses no longer exist',
    )
  }
  if (patch.enabled === true && triggers.some((trigger) => !trigger.providerWiring)) {
    throw new AppError(
      409,
      'trigger_group_not_ready',
      'Every shared provider ingress must be finalized before enabling this Watch Group',
    )
  }

  const currentMessageTemplate = group.messageTemplate ?? triggers[0]?.messageTemplate ?? ''
  const nextName = typeof patch.name === 'string' ? patch.name.trim().slice(0, 100) : group.name
  const nextMessageTemplate =
    typeof patch.messageTemplate === 'string'
      ? patch.messageTemplate.trim()
      : currentMessageTemplate
  const nextEnabled = typeof patch.enabled === 'boolean' ? patch.enabled : group.enabled

  if (!nextName || !nextMessageTemplate) {
    throw new AppError(400, 'invalid_request', 'name and messageTemplate are required')
  }

  // The shared prompt is what the ingresses actually execute, so changing it
  // requires outranking the current principal — until the identity moves, the
  // editor's instructions run with that principal's authority. The identity
  // itself only moves through the explicit Admin transfer, so editing never
  // promotes a Group to its editor's permissions.
  const substantiveChanged = nextMessageTemplate !== currentMessageTemplate

  if (substantiveChanged) {
    await assertTriggerExecutionMutationAccess(group, context)
  }

  const triggerById = new Map(
    triggers.flatMap((trigger) =>
      trigger._id ? [[trigger._id.toString(), trigger] as const] : [],
    ),
  )
  const changedTriggers: {
    id: string
    name: string
    messageTemplate: string
    enabled: boolean
  }[] = []

  try {
    for (const partition of group.partitions) {
      const id = partition.triggerId.toString()
      const trigger = triggerById.get(id)

      if (!trigger) {
        throw new AppError(
          409,
          'trigger_group_incomplete',
          'One or more Watch Group ingresses no longer exist',
        )
      }
      const nextTriggerName =
        typeof patch.name === 'string' ? `${nextName} · ${partition.provider}` : trigger.name
      const nextTriggerEnabled = typeof patch.enabled === 'boolean' ? nextEnabled : trigger.enabled

      if (
        trigger.name === nextTriggerName &&
        trigger.messageTemplate === nextMessageTemplate &&
        trigger.enabled === nextTriggerEnabled
      ) {
        continue
      }
      await updateTrigger(id, context, {
        name: nextTriggerName,
        messageTemplate: nextMessageTemplate,
        ...(typeof patch.enabled === 'boolean' ? { enabled: nextTriggerEnabled } : {}),
      })
      changedTriggers.push({
        id,
        name: trigger.name,
        messageTemplate: trigger.messageTemplate,
        enabled: trigger.enabled,
      })
    }

    const now = new Date()
    const result = await agentTriggerGroups().updateOne(
      {
        _id: group._id,
        teamId: group.teamId,
      },
      {
        $set: {
          name: nextName,
          messageTemplate: nextMessageTemplate,
          enabled: nextEnabled,
          updatedAt: now,
        },
      },
    )

    if (result.matchedCount === 0) {
      throw new AppError(404, 'trigger_group_not_found', 'Watch Group not found')
    }
    const updatedGroup: AgentTriggerGroup = {
      ...group,
      name: nextName,
      messageTemplate: nextMessageTemplate,
      enabled: nextEnabled,
      updatedAt: now,
    }
    const synchronizedTriggers = triggers.map((trigger) => {
      const partition = group.partitions.find(
        (candidate) => candidate.triggerId.toString() === trigger._id?.toString(),
      )

      return {
        ...trigger,
        name:
          typeof patch.name === 'string' && partition
            ? `${nextName} · ${partition.provider}`
            : trigger.name,
        messageTemplate: nextMessageTemplate,
        enabled: typeof patch.enabled === 'boolean' ? nextEnabled : trigger.enabled,
      }
    })

    return serializeTriggerGroup(updatedGroup, synchronizedTriggers)
  } catch (error) {
    // Keep the Group atomic from the user's perspective. If a later ingress
    // or the Group write fails, restore every ingress already changed.
    await Promise.allSettled(
      changedTriggers.map((trigger) =>
        updateTrigger(trigger.id, context, {
          name: trigger.name,
          messageTemplate: trigger.messageTemplate,
          enabled: trigger.enabled,
        }),
      ),
    )
    throw error
  }
}
