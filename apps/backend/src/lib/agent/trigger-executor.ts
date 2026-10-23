import { createHash, randomUUID } from 'node:crypto'

import { signNuphosToken } from '@/lib/identity'
import { SLACK_INCIDENT_BUSY_POSTS_PER_HOUR } from '@/lib/slack/incident-notifications'
import { runAgentForTrigger } from '@/routes/agent'
import { persistedMessageToUiMessage } from '@/routes/slack/messages'

import { buildTriggerRunStamp } from './conversation-trigger-run'
import { executeConversationTurn } from './conversation-turn'
import { getConversationBySessionId, getConversationWithMessages } from './db'
import { incidentDeliveryPolicy } from './incident-delivery-policy'
import { claimAgentRunForSession } from './run-admission'
import { agentTriggers, isRetiredTriggerShape } from './trigger-db'
import { resolveExecutionAuthorization } from './trigger-executor-authorization'
import {
  prepareIncidentContext,
  readReportedStatus,
  resolveMessageTemplate,
} from './trigger-executor-context'

import type { ConversationTriggerRunKind } from './conversation-trigger-run'
import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'
import type { AgentTrigger } from './trigger-db'
import type { TriggerGroupMember } from './trigger-group-db'
import type { UIMessage } from 'ai'

export { resolveMessageTemplate } from './trigger-executor-context'

type TriggerFireOptions = {
  /**
   * How this fire came about. Required — only the caller knows, and the run
   * list on the Trigger page exists to tell a scheduled fire apart from a
   * webhook and from someone pressing Run now. Defaulting it here would
   * mislabel runs silently.
   */
  runKind: ConversationTriggerRunKind
  sessionId?: string
  deliveryId?: string
  /** Stable per fire (the BullMQ job id), so a redelivered fire is not delivered twice. */
  fireId?: string
  incidentScope?: string
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
  const { principalUserId, credentialAccess, target } = await resolveExecutionAuthorization(trigger)
  const reportedStatus = readReportedStatus(webhookPayload)
  const context = templateContext(trigger, triggerId, webhookPayload, options, reportedStatus)

  // Exclusive with routing and incident mode, so nothing below applies to it.
  if (target) {
    await deliverToTargetSession(
      trigger,
      target,
      resolveMessageTemplate(trigger.messageTemplate, context),
      options.fireId,
    )

    return target.sessionId
  }

  if (trigger.incidentMode && !trigger.slackDestination) {
    throw new Error(
      `Incident trigger ${triggerId} has no stored Slack destination; refusing an unscoped outbound run`,
    )
  }
  const incidentScope = options.incidentScope ?? 'default'
  const sessionId = options.sessionId ?? randomUUID()
  const existing = options.sessionId ? await getConversationBySessionId(sessionId) : null

  if (existing && (existing.teamId !== trigger.teamId || existing.userId !== principalUserId)) {
    throw new Error('Routed session owner or team no longer matches the trigger')
  }
  const release = options.sessionId
    ? await claimAgentRunForSession(principalUserId, sessionId)
    : null

  if (options.sessionId && !release) throw new RoutedSessionBusyError()
  try {
    // An alert firing is a fact, so it is recorded before the agent decides
    // anything. Everything the agent is told about the past is a pointer: the
    // history itself is something it fetches, the way an on-call would.
    const incidentContext =
      trigger.incidentMode && trigger.teamId
        ? await prepareIncidentContext({
            teamId: trigger.teamId,
            triggerId,
            incidentScope,
            sessionId,
            reportedStatus,
          })
        : null

    const baseMessage = resolveMessageTemplate(trigger.messageTemplate, context)
    const resolvedMessage = trigger.incidentMode
      ? `${baseMessage}${incidentDeliveryPolicy({
          ...(reportedStatus ? { reportedStatus } : {}),
          ...(trigger.slackDestination ? { approvedDestination: trigger.slackDestination } : {}),
          hasPriorOccurrences: incidentContext?.hasPriorOccurrences ?? false,
          postsInLastHour: incidentContext?.postsInLastHour ?? 0,
          busyThreshold: SLACK_INCIDENT_BUSY_POSTS_PER_HOUR,
        })}`
      : baseMessage

    const prior = options.sessionId
      ? await getConversationWithMessages(sessionId, principalUserId, trigger.teamId)
      : null
    const history = (prior?.messages ?? [])
      .map(persistedMessageToUiMessage)
      .filter((message): message is UIMessage => message !== null)
    const messages: UIMessage[] = [
      ...history,
      {
        id: randomUUID(),
        role: 'user',
        metadata: triggerMetadata(trigger),
        parts: [{ type: 'text', text: resolvedMessage }],
      },
    ]

    // No inbound request to forward a Bearer token from, so mint one for the owner.
    await runAgentForTrigger({
      userId: principalUserId,
      nuphosToken: signNuphosToken(principalUserId, 60 * 60 * 8),
      teamId: trigger.teamId,
      sessionId,
      messages,
      firstMessage: resolvedMessage,
      // Self-replication guard: trigger-fired sessions must not create triggers.
      origin: 'trigger',
      credentialAccess,
      // Files this conversation under its trigger rather than in Chats.
      trigger: buildTriggerRunStamp({
        triggerId,
        runKind: options.runKind,
        ...(options.groupMember ? { groupMember: options.groupMember } : {}),
      }),
      ...(trigger.incidentMode && trigger.slackDestination
        ? {
            triggerNotification: {
              triggerId,
              incidentScope,
              triggerConfigRevision: trigger.configRevision ?? 0,
              approvedDestination: trigger.slackDestination,
            },
          }
        : {}),
    })

    await agentTriggers().updateOne(
      { _id: trigger._id },
      { $set: { lastRunAt: new Date(), updatedAt: new Date() } },
    )

    return sessionId
  } finally {
    release?.()
  }
}

/** A fire is the Trigger speaking, never the owner: shown and attributed as such. */
function triggerMetadata(trigger: AgentTrigger): MessageMetadata {
  const triggerId = trigger._id!.toHexString()

  return {
    version: 1,
    sender: { type: 'system', id: `trigger:${triggerId}`, displayName: trigger.name },
    source: 'agent.resource',
    resourceUrl: `/teams/${trigger.teamId}/triggers/${triggerId}`,
    sentAt: new Date().toISOString(),
  }
}

/**
 * Wakes the bound session the way a GitHub event does. A busy session parks the
 * message until its turn releases, and identical parked fires coalesce.
 */
async function deliverToTargetSession(
  trigger: AgentTrigger,
  target: AgentConversation,
  text: string,
  fireId: string | undefined,
): Promise<void> {
  const triggerId = trigger._id!.toHexString()
  const { sessionId } = target

  await executeConversationTurn(
    {
      userId: target.userId,
      // resolveExecutionAuthorization paused the Trigger unless this is its team.
      teamId: target.teamId!,
      targetSessionId: sessionId,
      messageId: fireId
        ? createHash('sha256').update(`${triggerId}:${fireId}`).digest('hex')
        : randomUUID(),
      locale: target.metadata?.locale ?? 'en-US',
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

export class RoutedSessionBusyError extends Error {
  constructor() {
    super('Routed session is busy')
  }
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
