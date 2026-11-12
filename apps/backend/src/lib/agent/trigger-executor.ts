import { createHash, randomUUID } from 'node:crypto'

import { buildTriggerRunStamp } from './conversation-trigger-run'
import { postChannelMessage } from './channel-chat'
import { executeConversationTurn } from './conversation-turn'
import { systemSender } from './message-metadata'
import { agentTriggers, isRetiredTriggerShape } from './trigger-db'
import { resolveExecutionAuthorization } from './trigger-executor-authorization'
import { readReportedStatus, resolveMessageTemplate } from './trigger-executor-context'

import type { ConversationTriggerRun, ConversationTriggerRunKind } from './conversation-trigger-run'
import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'
import type { AgentTrigger } from './trigger-db'
import type { TriggerGroupMember } from './trigger-group-db'

export { resolveMessageTemplate } from './trigger-executor-context'

type TriggerFireOptions = {
  /**
   * How this fire came about. Required — only the caller knows, and the run
   * list on the Trigger page exists to tell a scheduled fire apart from a
   * webhook and from someone pressing Run now. Defaulting it here would
   * mislabel runs silently.
   */
  runKind: ConversationTriggerRunKind
  deliveryId?: string
  /** Stable per fire (the BullMQ job id), so a redelivered fire is not delivered twice. */
  fireId?: string
  groupMember?: TriggerGroupMember
}

export async function executeTrigger(
  trigger: AgentTrigger,
  webhookPayload: unknown,
  options: TriggerFireOptions,
): Promise<string> {
  if (!trigger._id) throw new Error('Cannot execute a trigger without an id')
  if (isRetiredTriggerShape(trigger)) {
    throw new Error(`Trigger ${trigger._id.toHexString()} is a retired database alert`)
  }
  const triggerId = trigger._id.toHexString()
  const { target } = await resolveExecutionAuthorization(trigger)
  const reportedStatus = readReportedStatus(webhookPayload)
  const context = templateContext(trigger, triggerId, webhookPayload, options, reportedStatus)
  // The same stamp a new conversation is filed under. A bound session is not
  // re-stamped, so the turn itself has to carry it for usage attribution.
  const runStamp = buildTriggerRunStamp({
    triggerId,
    runKind: options.runKind,
    ...(options.groupMember ? { groupMember: options.groupMember } : {}),
    ...(options.fireId ? { fireId: options.fireId } : {}),
  })

  // Unbound Triggers never get here: authorization pauses them.
  await deliverToTargetSession(
    trigger,
    target,
    resolveMessageTemplate(trigger.messageTemplate, context),
    { fireId: options.fireId, trigger: runStamp },
  )

  return target.sessionId
}

/** A fire is the Trigger speaking, never the owner: shown and attributed as such. */
function triggerMetadata(trigger: AgentTrigger): MessageMetadata {
  const triggerId = trigger._id!.toHexString()

  return systemSender(
    `trigger:${triggerId}`,
    trigger.name,
    `/teams/${trigger.teamId}/triggers/${triggerId}`,
  )
}

/**
 * Wakes the bound session the way a GitHub event does. A busy session parks the
 * message until its turn releases, and identical parked fires coalesce.
 */
async function deliverToTargetSession(
  trigger: AgentTrigger,
  target: AgentConversation,
  text: string,
  delivery: { fireId?: string; trigger: ConversationTriggerRun },
): Promise<void> {
  const triggerId = trigger._id!.toHexString()
  const { sessionId } = target

  const messageId = delivery.fireId
    ? createHash('sha256').update(`${triggerId}:${delivery.fireId}`).digest('hex')
    : randomUUID()

  if (target.kind === 'channel') {
    await postChannelMessage(target, { id: messageId, text, metadata: triggerMetadata(trigger) })
  } else
    await executeConversationTurn(
      {
        userId: target.userId,
        // resolveExecutionAuthorization paused the Trigger unless this is its team.
        teamId: target.teamId!,
        targetSessionId: sessionId,
        messageId,
        locale: target.metadata?.locale ?? 'en-US',
        trigger: delivery.trigger,
      },
      target,
      text,
      'agent.resource',
      triggerMetadata(trigger),
    )
  await agentTriggers().updateOne(
    { _id: trigger._id },
    { $set: { lastRunAt: new Date(), updatedAt: new Date() } },
  )
}

/**
 * Stable template context: `trigger.*` is always present; `payload.*` is the
 * webhook body (or undefined for cron). This way `{{payload.foo}}` resolves
 * for webhook triggers and templates don't have to special-case the source.
 */
function templateContext(
  trigger: AgentTrigger,
  triggerId: string,
  webhookPayload: unknown,
  options: TriggerFireOptions,
  reportedStatus: ReturnType<typeof readReportedStatus>,
) {
  return {
    trigger: {
      id: triggerId,
      name: trigger.name,
      firedAt: new Date().toISOString(),
      ...(options.deliveryId ? { deliveryId: options.deliveryId } : {}),
      ...(reportedStatus ? { reportedStatus } : {}),
      ...(options.groupMember
        ? {
            group: {
              member: {
                key: options.groupMember.key,
                provider: options.groupMember.provider,
                integrationId: options.groupMember.integrationId,
                kind: options.groupMember.kind,
                resourceId: options.groupMember.resourceId,
              },
            },
          }
        : {}),
    },
    ...(webhookPayload !== undefined ? { payload: webhookPayload } : {}),
  }
}
