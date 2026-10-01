import { randomBytes, timingSafeEqual } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import { inferLegacyMonitoringProvider } from './monitoring-workflow'

import type { AgentTrigger } from './trigger-db-types'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { Collection } from 'mongodb'

export type {
  AgentTrigger,
  TriggerExecutionAuthorizationStatus,
  TriggerSource,
  TriggerSourceContext,
  TriggerType,
} from './trigger-db-types'

const COLLECTION = 'agent_triggers'

export const agentTriggers = (): Collection<AgentTrigger> =>
  db().collection<AgentTrigger>(COLLECTION)

/** Excludes rows left by the removed database-alert feature, which must never be listed or run. */
export const liveTriggerShapeFilter = {
  triggerType: { $in: ['cron', 'webhook'] as AgentTrigger['triggerType'][] },
  databaseAlert: { $exists: false },
}

export function isRetiredTriggerShape(trigger: AgentTrigger): boolean {
  return (
    (trigger.triggerType !== 'cron' && trigger.triggerType !== 'webhook') ||
    'databaseAlert' in trigger
  )
}

/** Mongo selector that treats legacy triggers without a revision as zero. */
export function triggerConfigRevisionFilter(
  revision: number,
):
  | { configRevision: number }
  | { $or: ({ configRevision: number } | { configRevision: { $exists: false } })[] } {
  return revision === 0
    ? { $or: [{ configRevision: 0 }, { configRevision: { $exists: false } }] }
    : { configRevision: revision }
}

/**
 * Re-check the persisted authorization immediately around an outbound side
 * effect. This fences trigger runs that loaded before a reroute, disable, or
 * message-template edit.
 */
export async function isSlackTriggerNotificationConfigurationCurrent(input: {
  triggerId: string
  userId: string
  teamId: string
  configRevision: number
  approvedDestination: SlackOutboundDestination
}): Promise<boolean> {
  if (!ObjectId.isValid(input.triggerId)) return false
  const destinationFilter =
    input.approvedDestination.type === 'channel'
      ? {
          'slackDestination.type': 'channel' as const,
          'slackDestination.channelId': input.approvedDestination.channelId,
        }
      : { 'slackDestination.type': 'dm_self' as const }
  const current = await agentTriggers().findOne(
    {
      _id: new ObjectId(input.triggerId),
      userId: input.userId,
      teamId: input.teamId,
      enabled: true,
      incidentMode: true,
      ...destinationFilter,
      ...triggerConfigRevisionFilter(input.configRevision),
    },
    { projection: { _id: 1 } },
  )

  return current !== null
}

export async function setupTriggerIndexes(): Promise<void> {
  const c = agentTriggers()

  try {
    // Team ownership and execution identity were introduced after triggers
    // already existed. Backfill only metadata: schedules, secrets, receipts,
    // run history, and provider wiring remain byte-for-byte untouched.
    await c.updateMany(
      {
        $or: [
          { createdByUserId: { $exists: false } },
          { executionPrincipalUserId: { $exists: false } },
          { executionAuthorizationStatus: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            createdByUserId: { $ifNull: ['$createdByUserId', '$userId'] },
            executionPrincipalUserId: {
              $ifNull: ['$executionPrincipalUserId', { $ifNull: ['$createdByUserId', '$userId'] }],
            },
            executionAuthorizationStatus: {
              $ifNull: ['$executionAuthorizationStatus', 'unchecked'],
            },
          },
        },
      ],
    )
    // One-time migration for Watches created before monitoringIdentity was
    // persisted. Runtime ownership never depends on editable message text:
    // the recognized provider is stamped immutably before normal traffic.
    const legacyRows = await c
      .find({
        triggerType: 'webhook',
        source: 'agent',
        providerWiring: { $exists: false },
        monitoringIdentity: { $exists: false },
        legacyProviderChecked: { $exists: false },
      })
      .limit(1000)
      .toArray()

    for (const trigger of legacyRows) {
      if (!trigger._id) continue
      const provider = inferLegacyMonitoringProvider({
        triggerType: 'webhook',
        source: trigger.source,
        messageTemplate: trigger.messageTemplate,
      })

      await c.updateOne(
        {
          _id: trigger._id,
          messageTemplate: trigger.messageTemplate,
          legacyProviderChecked: { $exists: false },
        },
        {
          $set: {
            legacyProviderChecked: true,
            ...(provider ? { legacyMonitoringProvider: provider } : {}),
          },
        },
      )
    }

    await c.createIndex({ userId: 1, createdAt: -1 }, { background: true })
    await c.createIndex({ userId: 1, teamId: 1, createdAt: -1 }, { background: true })
    await c.createIndex(
      { teamId: 1, createdAt: -1 },
      { background: true, name: 'trigger_team_createdAt' },
    )
    // Creation resolves a team Watch by its creator-independent identity so
    // colleagues converge on one row instead of duplicating provider wiring.
    //
    // Deliberately not unique. Convergence under concurrency is already
    // enforced by trigger_dedupe_key_unique below: two colleagues now derive
    // the same team-scoped dedupeKey, so the loser of a race resolves to the
    // winner's row. This index only accelerates the lookup that also catches
    // rows still carrying a pre-team-ownership key. Making it unique would
    // fail to build against the duplicates this change exists to prevent, and
    // because every index here shares one catch, that failure would silently
    // skip the unique indexes created after it.
    await c.createIndex(
      {
        teamId: 1,
        'monitoringIdentity.provider': 1,
        'monitoringIdentity.integrationId': 1,
        'monitoringIdentity.resourceId': 1,
      },
      {
        partialFilterExpression: { monitoringIdentity: { $exists: true } },
        background: true,
        name: 'trigger_team_monitoring_identity',
      },
    )
    await c.createIndex({ triggerType: 1, enabled: 1 }, { background: true })
    // Idempotent automation: one trigger per dedupeKey. Partial so the vast
    // majority of rows (no key) stay out of the index.
    await c.createIndex(
      { dedupeKey: 1 },
      {
        unique: true,
        partialFilterExpression: { dedupeKey: { $exists: true } },
        background: true,
        name: 'trigger_dedupe_key_unique',
      },
    )
    // Expiry sweep scans enabled triggers whose expiresAt has passed.
    await c.createIndex(
      { enabled: 1, expiresAt: 1 },
      {
        partialFilterExpression: { expiresAt: { $exists: true } },
        background: true,
        name: 'trigger_expiry_sweep',
      },
    )
    await c.createIndex(
      { watchGroupId: 1, watchGroupPartitionKey: 1 },
      {
        unique: true,
        partialFilterExpression: {
          watchGroupId: { $exists: true },
          watchGroupPartitionKey: { $exists: true },
        },
        background: true,
        name: 'trigger_group_partition_unique',
      },
    )
  } catch (err) {
    logError('agent.trigger.indexes_create_failed', err)
  }
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

// Constant-time comparison of the bearer-style header the caller sends in
// `X-Webhook-Secret` against the trigger's stored secret. We dropped HMAC body
// signing because the senders we actually need to accept (Grafana, Linear,
// Vercel, ad-hoc curl) don't sign bodies natively. Security model: secret is
// 256 bits of entropy + TLS in transit + constant-time compare to avoid
// length / byte-by-byte timing oracles.
export function verifyWebhookSecret(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)

    if (a.length !== b.length) return false

    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
