import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'
import { createSlackOutboundContext } from '@/lib/slack/agent-outbound'

import { triggerExecutionPrincipalId } from '../trigger-access'

import { getOwnedTriggerGroup } from './read'
import { loadPartitionTriggers } from './shared'

import type { TriggerActorContext } from '../trigger-access'
import type { AgentTrigger } from '../trigger-db'
import type { AgentTriggerGroup } from '../trigger-group-db'
import type { TestTriggerGroupResult } from './shared'

export function assertTriggerGroupReadyForTest(
  group: AgentTriggerGroup,
  triggers: AgentTrigger[],
): void {
  if (!group.enabled) {
    throw new AppError(409, 'trigger_group_paused', 'Enable the Watch Group before testing')
  }
  if (triggers.length !== group.partitions.length) {
    throw new AppError(
      409,
      'trigger_group_incomplete',
      'One or more Watch Group ingresses no longer exist',
    )
  }
  const triggerById = new Map(
    triggers.flatMap((trigger) =>
      trigger._id ? [[trigger._id.toString(), trigger] as const] : [],
    ),
  )
  const groupIdString = group._id?.toString()

  if (!groupIdString) {
    throw new AppError(409, 'trigger_group_incomplete', 'Watch Group identity is missing')
  }

  const selectedMemberKeys = new Set(group.members.map((member) => member.key))
  const partitionMemberKeys = new Set(group.partitions.flatMap((partition) => partition.memberKeys))

  if (
    selectedMemberKeys.size !== partitionMemberKeys.size ||
    [...selectedMemberKeys].some((memberKey) => !partitionMemberKeys.has(memberKey))
  ) {
    throw new AppError(
      409,
      'trigger_group_incomplete',
      'Every selected member must be assigned to a shared provider ingress',
    )
  }

  for (const partition of group.partitions) {
    const trigger = triggerById.get(partition.triggerId.toString())

    if (!trigger?.enabled) {
      throw new AppError(
        409,
        'trigger_group_not_ready',
        'Every shared provider ingress must be enabled before testing',
      )
    }
    const receipt = trigger.providerWiring

    if (
      receipt?.provider !== 'watch_group' ||
      receipt.groupId !== groupIdString ||
      receipt.partitionKey !== partition.key
    ) {
      throw new AppError(
        409,
        'trigger_group_not_ready',
        'Every shared provider ingress must have a finalized Group receipt before testing',
      )
    }
    const receiptMembers = new Set(receipt.memberKeys)
    const matchedMembers = new Set(receipt.eventMatches.map((match) => match.memberKey))

    if (
      partition.memberKeys.some(
        (memberKey) => !receiptMembers.has(memberKey) || !matchedMembers.has(memberKey),
      )
    ) {
      throw new AppError(
        409,
        'trigger_group_matcher_incomplete',
        'A shared provider ingress is missing one or more selected member matchers',
      )
    }
  }
}

/**
 * Verify a Watch Group without manufacturing a provider alert or opening an
 * incident. Provider-native drills deliberately carry `test: true` and stop
 * before investigation/Slack; this UI action instead validates the complete
 * stored Group mapping and sends one clearly marked destination test.
 *
 * Real provider webhooks keep using matchTriggerGroupMembers + executeTrigger.
 * This path does not claim member cooldowns, create an incident conversation,
 * or mutate provider resources.
 */
export async function testTriggerGroup(
  groupId: string,
  context: TriggerActorContext,
): Promise<TestTriggerGroupResult> {
  const group = await getOwnedTriggerGroup(groupId, context, 'manage')
  const triggers = await loadPartitionTriggers(group)

  assertTriggerGroupReadyForTest(group, triggers)

  if (!group.slackDestination) {
    return {
      ok: true,
      verifiedIngressCount: triggers.length,
      verifiedMemberCount: group.members.length,
      delivery: 'nuphos',
    }
  }

  const slack = await createSlackOutboundContext({
    userId: triggerExecutionPrincipalId(group),
    conversationId: randomUUID(),
    teamId: group.teamId,
  })

  if (!slack) {
    throw new AppError(
      409,
      'slack_not_connected',
      'The Slack destination stored on this Watch Group is no longer available',
    )
  }
  const delivery = await slack.post({
    destination: group.slackDestination,
    text:
      `🧪 Test notification from Nuphos Watch Group “${group.name}”.\n` +
      `${String(triggers.length)} shared ingress${triggers.length === 1 ? '' : 'es'} covering ` +
      `${String(group.members.length)} monitored item${group.members.length === 1 ? '' : 's'} ` +
      'were verified. This is only a delivery test; no incident was opened and no investigation ran.',
    bindConversation: false,
  })

  if (!delivery.ok) {
    throw new AppError(502, 'slack_test_delivery_failed', delivery.error)
  }

  return {
    ok: true,
    verifiedIngressCount: triggers.length,
    verifiedMemberCount: group.members.length,
    delivery: 'slack',
    destinationLabel: delivery.destination.label,
  }
}
