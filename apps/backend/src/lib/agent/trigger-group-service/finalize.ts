import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { assertTriggerAccess } from '../trigger-access'
import { agentTriggers } from '../trigger-db'
import { serializeTrigger } from '../trigger-service'

import { assertGroupIngressWiringConsistent } from './finalize-checks'
import { getOwnedTriggerGroup } from './read'

import type { TriggerGroupMember } from '../trigger-group-db'
import type { WatchGroupProviderWiring } from '../trigger-provider-wiring'

export function eventMatchUsesOnlyStableResourceIdentity(
  member: TriggerGroupMember,
  values: string[],
): boolean {
  const shortId = member.resourceId.split('/').at(-1) ?? member.resourceId
  const allowedValues = new Set([member.resourceId, shortId])

  return values.every((value) => allowedValues.has(value))
}

export async function finalizeTriggerGroupIngress(input: {
  triggerId: string
  userId: string
  teamId: string
  receipt: WatchGroupProviderWiring
}): Promise<ReturnType<typeof serializeTrigger>> {
  if (!ObjectId.isValid(input.triggerId) || !ObjectId.isValid(input.teamId)) {
    throw new AppError(400, 'invalid_request', 'Invalid Watch Group ingress ownership')
  }
  const triggerId = new ObjectId(input.triggerId)
  const trigger = await agentTriggers().findOne({ _id: triggerId })

  if (!trigger || trigger.teamId?.toString() !== input.teamId) {
    throw new AppError(404, 'trigger_not_found', 'Trigger not found')
  }
  await assertTriggerAccess(trigger, { userId: input.userId, teamId: input.teamId }, 'manage')
  if (!trigger?.watchGroupId || !trigger.watchGroupPartitionKey) {
    throw new AppError(409, 'not_group_ingress', 'Trigger is not a Watch Group ingress')
  }
  if (
    input.receipt.groupId !== trigger.watchGroupId.toString() ||
    input.receipt.partitionKey !== trigger.watchGroupPartitionKey ||
    input.receipt.integrationId === '' ||
    input.receipt.memberKeys.length !== trigger.watchGroupMemberKeys?.length ||
    input.receipt.memberKeys.some((key) => !trigger.watchGroupMemberKeys?.includes(key))
  ) {
    throw new AppError(
      409,
      'group_wiring_mismatch',
      'The provider receipt does not match this Watch Group ingress',
    )
  }
  if (
    input.receipt.eventMatches.length !== input.receipt.memberKeys.length ||
    input.receipt.eventMatches.some(
      (match) => !input.receipt.memberKeys.includes(match.memberKey),
    ) ||
    new Set(input.receipt.eventMatches.map((match) => match.memberKey)).size !==
      input.receipt.memberKeys.length
  ) {
    throw new AppError(
      400,
      'group_event_match_incomplete',
      'The verified event matcher must cover every selected member exactly once',
    )
  }
  const matchOwners = new Map<string, string>()

  for (const match of input.receipt.eventMatches) {
    for (const value of match.values) {
      const owner = matchOwners.get(value)

      if (owner && owner !== match.memberKey) {
        throw new AppError(
          400,
          'group_event_match_ambiguous',
          'Each verified provider event value may identify only one Watch Group member',
        )
      }
      matchOwners.set(value, match.memberKey)
    }
  }
  const group = await getOwnedTriggerGroup(
    input.receipt.groupId,
    {
      userId: input.userId,
      teamId: input.teamId,
    },
    'manage',
  )
  const partition = group.partitions.find((item) => item.triggerId.equals(triggerId))

  if (
    !partition ||
    partition.key !== input.receipt.partitionKey ||
    partition.provider !== input.receipt.providerKey ||
    partition.integrationId !== input.receipt.integrationId
  ) {
    throw new AppError(409, 'group_wiring_mismatch', 'Watch Group partition changed')
  }
  const membersByKey = new Map(group.members.map((member) => [member.key, member]))

  if (
    input.receipt.eventMatches.some((match) => {
      const member = membersByKey.get(match.memberKey)

      if (!member) return true

      return !eventMatchUsesOnlyStableResourceIdentity(member, match.values)
    })
  ) {
    throw new AppError(
      400,
      'group_event_match_non_identity',
      'Verified event matchers may contain only that member’s full or terminal stable provider resource id',
    )
  }
  await assertGroupIngressWiringConsistent({
    receipt: input.receipt,
    partition,
    group,
    teamId: input.teamId,
    triggerId: input.triggerId,
  })
  const now = new Date()
  const updated = await agentTriggers().findOneAndUpdate(
    {
      _id: triggerId,
      teamId: input.teamId,
      enabled: false,
      cleanupStatus: { $exists: false },
    },
    {
      $set: {
        providerWiring: input.receipt,
        providerWiringFinalizedAt: now,
        enabled: true,
        updatedAt: now,
      },
      $inc: { configRevision: 1 },
    },
    { returnDocument: 'after' },
  )

  if (!updated) {
    throw new AppError(
      409,
      'group_wiring_already_finalized',
      'Watch Group ingress changed or was already finalized',
    )
  }

  return serializeTrigger(updated)
}
