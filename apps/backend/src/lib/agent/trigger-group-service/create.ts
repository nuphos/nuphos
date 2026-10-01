import { createHash } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { assertTeamTriggerRole } from '../trigger-access'
import { resolveTriggerGroupCredentialMode } from '../trigger-credential-access'
import { agentTriggers } from '../trigger-db'
import { agentTriggerGroups, isSharedIngressTriggerGroup } from '../trigger-group-db'
import {
  assertTriggerCreationQuota,
  createTrigger,
  resolveTriggerCredentialSelection,
  serializeTrigger,
} from '../trigger-service'
import { assertTriggerSlackDestinationAuthorized } from '../trigger-slack-authorization'

import { findExistingTriggerGroup, triggerGroupDedupeKey } from './dedupe'
import {
  loadPartitionTriggers,
  normalizeMembers,
  partitionMembers,
  serializeTriggerGroup,
} from './shared'

import type { TriggerActorContext } from '../trigger-access'
import type { AgentTriggerGroup, TriggerGroupPartition } from '../trigger-group-db'
import type { CreateTriggerGroupInput, SerializedTriggerGroup } from './shared'

export async function createTriggerGroup(
  input: CreateTriggerGroupInput,
  context: TriggerActorContext,
): Promise<{
  group: SerializedTriggerGroup
  ingresses: (ReturnType<typeof serializeTrigger> & {
    partitionKey: string
    provider: string
    integrationId: string
    memberKeys: string[]
  })[]
}> {
  if (!context.teamId || !ObjectId.isValid(context.teamId)) {
    throw new AppError(
      400,
      'trigger_group_team_required',
      'A valid team is required to create a Watch Group',
    )
  }
  // Checked at the service boundary so HTTP, Agent tools, and automation
  // cannot disagree about who may create a team Watch Group.
  await assertTeamTriggerRole(context, 'manage')
  const name = input.name.trim().slice(0, 100)
  const messageTemplate = input.messageTemplate.trim()

  if (!name || !messageTemplate) {
    throw new AppError(400, 'invalid_request', 'name and messageTemplate are required')
  }
  const members = normalizeMembers(input.memberKeys)

  if (input.slackDestination) {
    await assertTriggerSlackDestinationAuthorized(input.slackDestination, context)
  }
  // A Watch Group is a team resource, so its identity excludes the creator:
  // two colleagues selecting the same monitoring items converge on one Group
  // rather than provisioning two sets of provider ingresses.
  const groupIdentity = {
    teamId: context.teamId,
    memberKeys: members.map((member) => member.key),
    ...(input.slackDestination ? { slackDestination: input.slackDestination } : {}),
  }
  const dedupeKey = triggerGroupDedupeKey(groupIdentity)
  const legacyDedupeKey = triggerGroupDedupeKey({
    ...groupIdentity,
    userId: context.userId,
  })
  const now = new Date()
  const credentials = await resolveTriggerCredentialSelection(context)
  const initialGroup: AgentTriggerGroup & { _id: ObjectId } = {
    _id: new ObjectId(),
    userId: context.userId,
    teamId: context.teamId,
    createdByUserId: context.userId,
    executionPrincipalUserId: context.userId,
    ...credentials,
    executionAuthorizationStatus: 'unchecked',
    name,
    messageTemplate,
    members,
    // Reserve the idempotency boundary before creating ingress rows. A retry
    // can now distinguish an in-flight v2 creator from an old orphan and
    // resume after a process crash.
    partitions: [],
    dedupeKey,
    ...(input.minIntervalSeconds !== undefined
      ? { minIntervalSeconds: input.minIntervalSeconds }
      : {}),
    ...(input.slackDestination ? { slackDestination: input.slackDestination } : {}),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
  let group = await findExistingTriggerGroup({
    dedupeKey,
    legacyDedupeKey,
    teamId: context.teamId,
    memberKeys: groupIdentity.memberKeys,
    ...(input.slackDestination ? { slackDestination: input.slackDestination } : {}),
  })

  if (!group) {
    // One Watch Group costs one quota slot; its partitions are an internal
    // fan-out and deliberately do not each consume one.
    await assertTriggerCreationQuota(context)
    try {
      await agentTriggerGroups().insertOne(initialGroup)
      group = initialGroup
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error
      group = await findExistingTriggerGroup({
        dedupeKey,
        legacyDedupeKey,
        teamId: context.teamId,
        memberKeys: groupIdentity.memberKeys,
        ...(input.slackDestination ? { slackDestination: input.slackDestination } : {}),
      })
      if (!group) throw error
    }
  }
  if (!isSharedIngressTriggerGroup(group) || !group._id) {
    throw new AppError(
      409,
      'trigger_group_dedupe_conflict',
      'That Watch Group identity belongs to an incompatible legacy workflow',
    )
  }

  const partitionInputs = partitionMembers(group.members)
  const existingTriggers = await agentTriggers()
    .find({
      teamId: context.teamId,
      watchGroupId: group._id,
    })
    .toArray()
  const partitions: TriggerGroupPartition[] = []

  // No rollback on failure: the disabled ingress rows and the durable Group
  // reservation stay put so the caller's retry resumes instead of colliding
  // with its own dedupe keys.
  for (const partition of partitionInputs) {
    const partitionDedupeKey = `${dedupeKey}:${createHash('sha256').update(partition.key).digest('hex')}`
    let trigger = existingTriggers.find(
      (candidate) =>
        candidate.watchGroupPartitionKey === partition.key &&
        candidate.watchGroupId?.equals(group._id),
    )

    if (!trigger) {
      // Builds from before the durable Group reservation could leave a
      // disabled, unwired ingress after a process crash. Reclaim it only
      // when its former Group truly does not exist.
      const stale = await agentTriggers().findOne({ dedupeKey: partitionDedupeKey })

      if (
        stale?._id &&
        stale.watchGroupId &&
        !stale.enabled &&
        !stale.providerWiring &&
        !stale.cleanupStatus &&
        !(await agentTriggerGroups().findOne(
          { _id: stale.watchGroupId },
          { projection: { _id: 1 } },
        ))
      ) {
        await agentTriggers().deleteOne({
          _id: stale._id,
          dedupeKey: partitionDedupeKey,
          enabled: false,
          providerWiring: { $exists: false },
          cleanupStatus: { $exists: false },
          watchGroupId: stale.watchGroupId,
        })
      }
      const created = await createTrigger(
        {
          name: `${group.name} · ${partition.provider}`,
          triggerType: 'webhook',
          messageTemplate: group.messageTemplate ?? messageTemplate,
          dedupeKey: partitionDedupeKey,
          enabled: false,
          ...(group.minIntervalSeconds !== undefined
            ? { minIntervalSeconds: group.minIntervalSeconds }
            : {}),
          ...(group.slackDestination
            ? { incidentMode: true, slackDestination: group.slackDestination }
            : {}),
          watchGroup: {
            groupId: group._id.toString(),
            partitionKey: partition.key,
            memberKeys: partition.memberKeys,
          },
        },
        {
          ...context,
          // Every ingress inherits the Group's binding, so partitions cannot
          // drift apart in scope.
          credentialMode: resolveTriggerGroupCredentialMode(group),
          ...(group.executionCredentialAccess
            ? { credentialAccess: group.executionCredentialAccess }
            : {}),
          source: 'agent',
          ...(context.sessionId ? { sourceContext: { sessionId: context.sessionId } } : {}),
        },
      )

      if (!created.id || !ObjectId.isValid(created.id)) {
        throw new Error('Watch Group ingress creation returned no trigger id')
      }
      trigger = (await agentTriggers().findOne({ _id: new ObjectId(created.id) })) ?? undefined
      if (!trigger?._id) {
        throw new Error('Watch Group ingress disappeared during creation')
      }
    }
    partitions.push({ ...partition, triggerId: trigger._id })
  }
  const updatedAt = new Date()

  await agentTriggerGroups().updateOne(
    { _id: group._id, dedupeKey },
    { $set: { partitions, updatedAt } },
  )
  const completedGroup: AgentTriggerGroup = { ...group, partitions, updatedAt }
  const triggers = await loadPartitionTriggers(completedGroup)

  return {
    group: serializeTriggerGroup(completedGroup, triggers),
    ingresses: partitions.flatMap((partition) => {
      const trigger = triggers.find((item) => item._id?.equals(partition.triggerId))

      return trigger
        ? [
            {
              ...serializeTrigger(trigger, true),
              partitionKey: partition.key,
              provider: partition.provider,
              integrationId: partition.integrationId,
              memberKeys: partition.memberKeys,
            },
          ]
        : []
    }),
  }
}
