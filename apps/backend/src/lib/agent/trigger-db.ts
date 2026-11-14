import { randomBytes, timingSafeEqual } from 'node:crypto'

import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { AgentTrigger } from './trigger-db-types'
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

export async function setupTriggerIndexes(): Promise<void> {
  const c = agentTriggers()

  try {
    // Execution status was introduced after triggers already existed.
    await c.updateMany(
      { executionAuthorizationStatus: { $exists: false } },
      { $set: { executionAuthorizationStatus: 'unchecked' } },
    )
    await c.createIndex({ userId: 1, createdAt: -1 }, { background: true })
    await c.createIndex({ userId: 1, teamId: 1, createdAt: -1 }, { background: true })
    await c.createIndex(
      { teamId: 1, createdAt: -1 },
      { background: true, name: 'trigger_team_createdAt' },
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
