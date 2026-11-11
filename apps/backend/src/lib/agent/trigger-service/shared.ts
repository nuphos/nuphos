import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { getConversationBySessionId } from '../db'
import { agentTriggers, isRetiredTriggerShape } from '../trigger-db'

import type { MonitoringIdentity } from '../monitoring-workflow'
import type { TriggerActorContext } from '../trigger-access'
import type { AgentTrigger, TriggerSource, TriggerSourceContext, TriggerType } from '../trigger-db'

/** Who is performing a trigger mutation, and on whose behalf. */
export type TriggerCallerContext = {
  source: TriggerSource
  sourceContext?: TriggerSourceContext
} & TriggerActorContext

export type CreateTriggerInput = {
  name: string
  triggerType: TriggerType
  cronExpression?: string
  timeZone?: string
  /** Existing conversation every fire is delivered into. Every Trigger has one. */
  targetSessionId: string
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
}

export type UpdateTriggerPatch = {
  name?: string
  messageTemplate?: string
  enabled?: boolean
  cronExpression?: string
  timeZone?: string
  /** Move delivery to another existing conversation. A Trigger cannot be unbound. */
  targetSessionId?: string
  minIntervalSeconds?: number
}

/** A Trigger may only wake a conversation its execution principal owns. */
export async function assertBindableSession(
  sessionId: string,
  teamId: string | undefined,
  principalUserId: string,
): Promise<void> {
  const target = await getConversationBySessionId(sessionId)

  if (!teamId || !target || target.teamId !== teamId || target.userId !== principalUserId) {
    throw new AppError(
      400,
      'invalid_target_session',
      'targetSessionId must be a conversation of the Trigger owner in this team',
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
