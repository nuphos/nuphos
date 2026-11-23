import { randomBytes } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db/shared'
import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { Collection } from 'mongodb'

export const WEBHOOK_EVENTS = [
  'session.turn.completed',
  'session.turn.failed',
  'session.input_required',
  'task.reported',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export type WebhookAttempt = { at: Date; status: number | null; ok: boolean; error?: string }

/** An HTTPS endpoint a team administrator registered for lifecycle events. */
export type TeamWebhook = {
  _id: ObjectId
  teamId: string
  name: string
  url: string
  events: WebhookEvent[]
  /** Sent with every request; values are write-only. */
  headers: { name: string; value: EncryptedSecret }[]
  enabled: boolean
  /** Why delivery switched the endpoint off. */
  disabledReason?: string
  lastDelivery?: WebhookAttempt & { type: string }
  /** Events are built from what this administrator can read. */
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

/**
 * One event for one endpoint. It is queued as a bare "look at this session"
 * and turned into a payload, once, on its first attempt; retries resend it.
 */
export type WebhookDelivery = {
  _id: string
  webhookId: ObjectId
  teamId: string
  sessionId: string
  /** Forces the event type; otherwise the session's status picks it. */
  hint?: WebhookEvent
  type?: WebhookEvent
  /** Hash of the session state the payload describes, for de-duplication. */
  stateHash?: string
  body?: string
  state: 'pending' | 'delivered' | 'skipped' | 'failed'
  attempts: number
  /** Also the claim: a worker moves it forward while it holds the delivery. */
  nextAttemptAt: Date
  lastError?: string
  createdAt: Date
}

export const teamWebhooks = (): Collection<TeamWebhook> =>
  db().collection<TeamWebhook>('team_webhooks')

export const webhookDeliveries = (): Collection<WebhookDelivery> =>
  db().collection<WebhookDelivery>('team_webhook_deliveries')

export async function setupWebhookIndexes(): Promise<void> {
  await teamWebhooks().createIndex({ teamId: 1, enabled: 1 }, { name: 'team_webhooks_team' })
  await webhookDeliveries().createIndex(
    { state: 1, nextAttemptAt: 1 },
    { name: 'team_webhook_deliveries_due' },
  )
  // The same state is announced to an endpoint once, however many hooks fire.
  await webhookDeliveries().createIndex(
    { webhookId: 1, sessionId: 1, type: 1, stateHash: 1 },
    {
      name: 'team_webhook_deliveries_once',
      unique: true,
      partialFilterExpression: { stateHash: { $exists: true } },
    },
  )
  await webhookDeliveries().createIndex(
    { createdAt: 1 },
    { name: 'team_webhook_deliveries_ttl', expireAfterSeconds: 7 * 24 * 60 * 60 },
  )
}

/** Lets the session settle, so one burst of changes is read as one state. */
export const SETTLE_MS = 3_000

export const newEventId = () => `evt_${randomBytes(12).toString('hex')}`

/** Queues a look at the session for each enabled endpoint of its team. Never throws. */
export function queueWebhookEvents(sessionId: string, hint?: WebhookEvent): void {
  void (async () => {
    const conversation = await agentConversations().findOne(
      { sessionId },
      { projection: { teamId: 1, webhookId: 1 } },
    )
    const teamId = conversation?.teamId

    if (!teamId) return
    // A session started for one endpoint (nuphos_ask's webhook_id) reaches only that one.
    const only = conversation.webhookId ? { _id: new ObjectId(conversation.webhookId) } : {}
    const hooks = await teamWebhooks()
      .find({ teamId, enabled: true, ...only }, { projection: { _id: 1 } })
      .toArray()

    if (hooks.length === 0) return
    const now = new Date()

    await webhookDeliveries().insertMany(
      hooks.map((hook) => ({
        _id: newEventId(),
        webhookId: hook._id,
        teamId,
        sessionId,
        ...(hint ? { hint } : {}),
        state: 'pending' as const,
        attempts: 0,
        nextAttemptAt: new Date(now.getTime() + SETTLE_MS),
        createdAt: now,
      })),
    )
  })().catch((error: unknown) => {
    logError('webhooks.queue_failed', error, { session_id: sessionId })
  })
}
