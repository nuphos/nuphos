import { createHash, randomUUID } from 'node:crypto'

import { withRedisLogContext } from '@/lib/redis-op-log'

import { postChannelMessage } from './channel-chat'
import { buildTriggerRunStamp } from './conversation-trigger-run'
import { startConversationTurn } from './conversation-turn'
import { systemSender } from './message-metadata'
import { isRetiredTriggerShape } from './trigger-db'
import { resolveExecutionAuthorization } from './trigger-executor-authorization'
import { readReportedStatus, resolveMessageTemplate } from './trigger-executor-context'
import { TRIGGER_SENDER_PREFIX, recordTriggerRan } from './trigger-missed-runs'

import type { ConversationTriggerRun, ConversationTriggerRunKind } from './conversation-trigger-run'
import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'
import type { AgentTrigger } from './trigger-db'

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
}

export async function executeTrigger(
  trigger: AgentTrigger,
  webhookPayload: unknown,
  options: TriggerFireOptions,
): Promise<string> {
  const { sessionId, run } = await fireTrigger(trigger, webhookPayload, options)

  await run

  return sessionId
}

/**
 * Hands the fire to its bound conversation and resolves once it is accepted: started, or parked
 * behind the turn running there. `run` settles when its turn has run.
 */
export async function fireTrigger(
  trigger: AgentTrigger,
  webhookPayload: unknown,
  options: TriggerFireOptions,
): Promise<{ sessionId: string; run: Promise<unknown> }> {
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
    ...(options.fireId ? { fireId: options.fireId } : {}),
  })

  // Unbound Triggers never get here: authorization pauses them.
  const { run } = await deliverToTargetSession(
    trigger,
    target,
    resolveMessageTemplate(trigger.messageTemplate, context),
    { fireId: options.fireId, trigger: runStamp },
  )

  return { sessionId: target.sessionId, run }
}

/** A fire is the Trigger speaking, never the owner: shown and attributed as such. */
function triggerMetadata(trigger: AgentTrigger): MessageMetadata {
  const triggerId = trigger._id!.toHexString()

  return systemSender(
    `${TRIGGER_SENDER_PREFIX}${triggerId}`,
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
): Promise<{ run: Promise<unknown> }> {
  const triggerId = trigger._id!.toHexString()
  const { sessionId } = target

  const messageId = delivery.fireId
    ? createHash('sha256').update(`${triggerId}:${delivery.fireId}`).digest('hex')
    : randomUUID()

  if (target.kind === 'channel') {
    await postChannelMessage(target, { id: messageId, text, metadata: triggerMetadata(trigger) })
    await recordTriggerRan(triggerId)

    return { run: Promise.resolve() }
  }

  // The turn records the run once it has run (runTurn), which may be later, from the queue.
  // A Redis op that fails during it names this session and route.
  return withRedisLogContext({ session_id: sessionId, route: 'agent.resource' }, () =>
    startConversationTurn(
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
    ),
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
    },
    ...(webhookPayload !== undefined ? { payload: webhookPayload } : {}),
  }
}
