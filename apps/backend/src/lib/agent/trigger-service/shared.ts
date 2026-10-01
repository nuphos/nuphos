import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { agentTriggers, isRetiredTriggerShape } from '../trigger-db'

import type { MonitoringIdentity } from '../monitoring-workflow'
import type { TriggerActorContext } from '../trigger-access'
import type { AgentTrigger, TriggerSource, TriggerSourceContext, TriggerType } from '../trigger-db'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'

/** Who is performing a trigger mutation, and on whose behalf. */
export type TriggerCallerContext = {
  source: TriggerSource
  sourceContext?: TriggerSourceContext
} & TriggerActorContext

export type CreateTriggerInput = {
  name: string
  triggerType: TriggerType
  cronExpression?: string
  messageTemplate: string
  /** Auto-disable after this time (hourly expiry sweep). */
  expiresAt?: Date
  /** Idempotency key: creating again with the same key returns the existing trigger. */
  dedupeKey?: string
  /** Stable identity for a provider Watch; valid only for webhook triggers. */
  monitoringIdentity?: MonitoringIdentity
  /** Internal shared-ingress metadata. Agent callers use trigger_group_create. */
  watchGroup?: {
    groupId: string
    partitionKey: string
    memberKeys: string[]
  }
  /** Internal setup fence; ordinary trigger creation defaults to enabled. */
  enabled?: boolean
  /** Webhook flood guard: min seconds between runs (default from config; 0 disables). */
  minIntervalSeconds?: number
  /** Stateful anti-spam delivery for monitoring webhooks that post to Slack. */
  incidentMode?: boolean
  /** Required with incidentMode; enforced again when slack_post executes. */
  slackDestination?: SlackOutboundDestination
}

export type UpdateTriggerPatch = {
  name?: string
  messageTemplate?: string
  enabled?: boolean
  cronExpression?: string
  minIntervalSeconds?: number
  incidentMode?: boolean
  /** Set a new exact destination, or null to clear it when disabling incident mode. */
  slackDestination?: SlackOutboundDestination | null
}

export function validateSlackDestination(destination: SlackOutboundDestination): void {
  if (destination.type === 'dm_self') return
  if (!destination.channelId.trim() || destination.channelId.length > 32) {
    throw new AppError(400, 'invalid_slack_destination', 'slackDestination.channelId is invalid')
  }
}

export function validateIncidentConfiguration(input: {
  triggerType: TriggerType
  incidentMode?: boolean
  slackDestination?: SlackOutboundDestination | null
}): void {
  if (input.triggerType !== 'webhook') {
    if (input.incidentMode !== undefined) {
      throw new AppError(
        400,
        'invalid_incident_mode',
        'incidentMode is only valid for webhook triggers',
      )
    }
    if (input.slackDestination !== undefined) {
      throw new AppError(
        400,
        'invalid_slack_destination',
        'slackDestination is only valid for webhook triggers',
      )
    }

    return
  }
  if (input.slackDestination) validateSlackDestination(input.slackDestination)
  if (input.incidentMode === true && !input.slackDestination) {
    throw new AppError(
      400,
      'missing_slack_destination',
      'incidentMode requires an explicit slackDestination',
    )
  }
  if (input.slackDestination && input.incidentMode !== true) {
    throw new AppError(
      400,
      'invalid_slack_destination',
      'slackDestination requires incidentMode=true',
    )
  }
}

export function validateMinInterval(triggerType: TriggerType, seconds: number): void {
  if (triggerType !== 'webhook') {
    throw new AppError(
      400,
      'invalid_min_interval',
      'minIntervalSeconds is only valid for webhook triggers',
    )
  }
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
    throw new AppError(
      400,
      'invalid_min_interval',
      'minIntervalSeconds must be an integer between 0 and 86400',
    )
  }
}

export type SerializedTrigger = ReturnType<typeof serializeTrigger>

export function serializeTrigger(trigger: AgentTrigger, exposeSecret = false) {
  const {
    _id,
    webhookSecret,
    dedupeKey: _dedupeKey,
    monitoringIdentity,
    watchGroupId,
    legacyMonitoringProvider,
    legacyProviderChecked: _legacyProviderChecked,
    executionCredentialAccess: _executionCredentialAccess,
    ...rest
  } = trigger
  const providerHint =
    trigger.providerWiring?.provider === 'generic'
      ? trigger.providerWiring.providerKey
      : (trigger.providerWiring?.provider ??
        monitoringIdentity?.provider ??
        legacyMonitoringProvider)

  return {
    id: _id?.toString(),
    ...rest,
    ...(watchGroupId ? { watchGroupId: watchGroupId.toString() } : {}),
    ...(providerHint ? { providerHint, requiresProviderCleanup: true as const } : {}),
    ...(exposeSecret && webhookSecret ? { webhookSecret } : {}),
  }
}

/** Loads a trigger by id for management; retired database-alert rows read as missing. */
export async function findManagedTrigger(_id: ObjectId): Promise<AgentTrigger> {
  const trigger = await agentTriggers().findOne({ _id })

  if (!trigger || isRetiredTriggerShape(trigger)) {
    throw new AppError(404, 'not_found', 'Trigger not found')
  }

  return trigger
}

export function standaloneTriggerFilter() {
  return { watchGroupId: { $exists: false } } as const
}

export function parseTriggerId(triggerId: string): ObjectId {
  if (!ObjectId.isValid(triggerId)) throw new AppError(400, 'invalid_id', 'Invalid triggerId')

  return new ObjectId(triggerId)
}

export function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000
}
