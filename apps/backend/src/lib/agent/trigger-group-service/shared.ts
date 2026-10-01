import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { agentTriggers } from '../trigger-db'
import {
  MAX_TRIGGER_GROUP_MEMBERS,
  parseTriggerGroupMemberKey,
  triggerGroupPartitionKey,
} from '../trigger-group-db'

import type { AgentTriggerGroup, TriggerGroupMember } from '../trigger-group-db'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'

export type TriggerGroupState = 'provisioning' | 'active' | 'partial' | 'paused'

export type CreateTriggerGroupInput = {
  name: string
  memberKeys: string[]
  messageTemplate: string
  minIntervalSeconds?: number
  slackDestination?: SlackOutboundDestination
}

export type UpdateTriggerGroupInput = {
  name?: string
  messageTemplate?: string
  enabled?: boolean
}

export type SerializedTriggerGroup = ReturnType<typeof serializeTriggerGroup>

export type TestTriggerGroupResult = {
  ok: true
  verifiedIngressCount: number
  verifiedMemberCount: number
  delivery: 'slack' | 'nuphos'
  destinationLabel?: string
}

export function parseGroupId(groupId: string): ObjectId {
  if (!ObjectId.isValid(groupId)) {
    throw new AppError(400, 'invalid_trigger_group_id', 'Invalid trigger group id')
  }

  return new ObjectId(groupId)
}

export function normalizeMembers(memberKeys: string[]): TriggerGroupMember[] {
  const normalized = memberKeys.map((key) => key.trim()).filter(Boolean)

  if (normalized.length < 2 || normalized.length > MAX_TRIGGER_GROUP_MEMBERS) {
    throw new AppError(
      400,
      'invalid_trigger_group_members',
      `A Watch Group requires between 2 and ${String(MAX_TRIGGER_GROUP_MEMBERS)} members`,
    )
  }
  if (normalized.some((key) => key.length > 1200)) {
    throw new AppError(
      400,
      'invalid_trigger_group_members',
      'Watch Group member keys must not exceed 1200 characters',
    )
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new AppError(400, 'invalid_trigger_group_members', 'Watch Group members must be unique')
  }
  const members = normalized.map(parseTriggerGroupMemberKey)

  if (members.some((member) => member === null)) {
    throw new AppError(
      400,
      'invalid_trigger_group_members',
      'Every Watch Group member must use the stable monitoring member-key format',
    )
  }
  const parsed = members as TriggerGroupMember[]

  if (
    parsed.some(
      (member) =>
        !/^[a-z0-9][a-z0-9._-]*$/.test(member.provider) ||
        member.provider.length > 64 ||
        member.integrationId.length > 512 ||
        !/^[a-z0-9][a-z0-9._-]*$/.test(member.kind) ||
        member.kind.length > 64 ||
        member.resourceId.length > 512,
    )
  ) {
    throw new AppError(
      400,
      'invalid_trigger_group_members',
      'Watch Group member identities exceed the supported provider schema',
    )
  }

  return parsed
}

export function partitionMembers(members: TriggerGroupMember[]): {
  key: string
  provider: string
  integrationId: string
  memberKeys: string[]
}[] {
  const partitions = new Map<
    string,
    {
      key: string
      provider: string
      integrationId: string
      memberKeys: string[]
    }
  >()

  for (const member of members) {
    const key = triggerGroupPartitionKey(member)
    const partition = partitions.get(key) ?? {
      key,
      provider: member.provider,
      integrationId: member.integrationId,
      memberKeys: [],
    }

    partition.memberKeys.push(member.key)
    partitions.set(key, partition)
  }

  return [...partitions.values()]
}

function groupCounts(
  group: AgentTriggerGroup,
  triggers: Awaited<ReturnType<typeof loadPartitionTriggers>>,
) {
  const readyPartitionCount = triggers.filter(
    // New Group ingresses finalize with the dedicated watch_group receipt.
    // Keep previously finalized prototype/repair rows visible as ready when
    // they already carry a valid ordinary provider receipt: the receipt still
    // proves that provider resources were recorded, and hiding those resources
    // would incorrectly regress an existing Watch back to "Provisioning".
    (trigger) => Boolean(trigger.providerWiring),
  ).length
  const enabledPartitionCount = triggers.filter(
    (trigger) => Boolean(trigger.providerWiring) && trigger.enabled,
  ).length
  const failedPartitionCount = triggers.filter(
    (trigger) => trigger.cleanupStatus === 'cleanup_failed',
  ).length

  return { readyPartitionCount, enabledPartitionCount, failedPartitionCount }
}

export function serializeTriggerGroup(
  group: AgentTriggerGroup,
  triggers: Awaited<ReturnType<typeof loadPartitionTriggers>>,
) {
  const { readyPartitionCount, enabledPartitionCount, failedPartitionCount } = groupCounts(
    group,
    triggers,
  )
  const state: TriggerGroupState =
    failedPartitionCount > 0
      ? 'partial'
      : readyPartitionCount < group.partitions.length
        ? 'provisioning'
        : !group.enabled || enabledPartitionCount === 0
          ? 'paused'
          : enabledPartitionCount < group.partitions.length
            ? 'partial'
            : 'active'

  return {
    id: group._id?.toString(),
    userId: group.userId,
    teamId: group.teamId,
    createdByUserId: group.createdByUserId ?? group.userId,
    executionPrincipalUserId:
      group.executionPrincipalUserId ?? group.createdByUserId ?? group.userId,
    executionAuthorizationStatus: group.executionAuthorizationStatus ?? 'unchecked',
    ...(group.executionAuthorizationCheckedAt
      ? { executionAuthorizationCheckedAt: group.executionAuthorizationCheckedAt }
      : {}),
    ...(group.executionAuthorizationError
      ? { executionAuthorizationError: group.executionAuthorizationError }
      : {}),
    name: group.name,
    messageTemplate: group.messageTemplate ?? triggers[0]?.messageTemplate ?? '',
    memberKeys: group.members.map((member) => member.key),
    expectedMemberCount: group.members.length,
    partitionCount: group.partitions.length,
    readyPartitionCount,
    failedPartitionCount,
    partitions: group.partitions.map((partition) => ({
      ...partition,
      triggerId: partition.triggerId.toString(),
    })),
    ...(group.slackDestination ? { slackDestination: group.slackDestination } : {}),
    enabled: group.enabled,
    state,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }
}

export async function loadPartitionTriggers(group: AgentTriggerGroup) {
  const ids = group.partitions.map((partition) => partition.triggerId)

  if (ids.length === 0) return []

  return agentTriggers()
    .find({ _id: { $in: ids } })
    .toArray()
}
