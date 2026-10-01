import { randomUUID } from 'node:crypto'

import { signNuphosToken } from '@/lib/identity'
import { SLACK_INCIDENT_BUSY_POSTS_PER_HOUR } from '@/lib/slack/incident-notifications'
import { runAgentForTrigger } from '@/routes/agent'

import { buildTriggerRunStamp } from './conversation-trigger-run'
import { incidentDeliveryPolicy } from './incident-delivery-policy'
import { agentTriggers, isRetiredTriggerShape } from './trigger-db'
import { resolveExecutionAuthorization } from './trigger-executor-authorization'
import {
  prepareIncidentContext,
  readReportedStatus,
  resolveMessageTemplate,
} from './trigger-executor-context'

import type { ConversationTriggerRunKind } from './conversation-trigger-run'
import type { AgentTrigger } from './trigger-db'
import type { TriggerGroupMember } from './trigger-group-db'
import type { UIMessage } from 'ai'

export { resolveMessageTemplate } from './trigger-executor-context'

export async function executeTrigger(
  trigger: AgentTrigger,
  webhookPayload: unknown,
  options: {
    /**
     * How this fire came about. Required — only the caller knows, and the run
     * list on the Trigger page exists to tell a scheduled fire apart from a
     * webhook and from someone pressing Run now. Defaulting it here would
     * mislabel runs silently.
     */
    runKind: ConversationTriggerRunKind
    incidentScope?: string
    groupMember?: TriggerGroupMember
  },
): Promise<string> {
  if (!trigger._id) throw new Error('Cannot execute a trigger without an id')
  if (isRetiredTriggerShape(trigger)) {
    throw new Error(`Trigger ${trigger._id.toHexString()} is a retired database alert`)
  }
  const triggerId = trigger._id.toHexString()
  const { principalUserId, credentialAccess } = await resolveExecutionAuthorization(trigger)

  if (trigger.incidentMode && !trigger.slackDestination) {
    throw new Error(
      `Incident trigger ${triggerId} has no stored Slack destination; refusing an unscoped outbound run`,
    )
  }
  const incidentScope = options.incidentScope ?? 'default'
  const sessionId = randomUUID()

  // An alert firing is a fact, so it is recorded before the agent decides
  // anything. Everything the agent is told about the past is a pointer: the
  // history itself is something it fetches, the way an on-call would.
  const reportedStatus = readReportedStatus(webhookPayload)
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

  // Stable template context: `trigger.*` is always present; `payload.*` is the
  // webhook body (or undefined for cron). This way `{{payload.foo}}` resolves
  // for webhook triggers and templates don't have to special-case the source.
  const contextPayload = {
    trigger: {
      id: triggerId,
      name: trigger.name,
      firedAt: new Date().toISOString(),
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

  const baseMessage = resolveMessageTemplate(trigger.messageTemplate, contextPayload)
  const resolvedMessage = trigger.incidentMode
    ? `${baseMessage}${incidentDeliveryPolicy({
        ...(reportedStatus ? { reportedStatus } : {}),
        ...(trigger.slackDestination ? { approvedDestination: trigger.slackDestination } : {}),
        hasPriorOccurrences: incidentContext?.hasPriorOccurrences ?? false,
        postsInLastHour: incidentContext?.postsInLastHour ?? 0,
        busyThreshold: SLACK_INCIDENT_BUSY_POSTS_PER_HOUR,
      })}`
    : baseMessage

  const messages: UIMessage[] = [
    {
      id: randomUUID(),
      role: 'user',
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
}
