import { randomBytes } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { isBot } from '@/lib/agent/db/read-state'
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

/**
 * The endpoint a session reports to: the one nuphos_ask's webhook_id named for
 * it or, for a Task, for its nearest ancestor. Read at queue time, so a Task
 * moved under another parent follows it. A Bot is never part of its parent's
 * subtree. It reports only to a webhook it was started with, and so do its Tasks.
 */
async function sessionWebhook(sessionId: string) {
  const seen = new Set([sessionId])
  const projection = { webhookId: 1, parentSessionId: 1, kind: 1, avatar: 1 }
  let link = await agentConversations().findOne(
    { sessionId },
    { projection: { ...projection, teamId: 1 } },
  )
  const teamId = link?.teamId

  while (
    link &&
    !link.webhookId &&
    !isBot(link) &&
    link.parentSessionId &&
    !seen.has(link.parentSessionId)
  ) {
    seen.add(link.parentSessionId)
    link = await agentConversations().findOne(
      { sessionId: link.parentSessionId, teamId },
      { projection },
    )
  }

  return teamId && link?.webhookId ? { teamId, webhookId: link.webhookId } : null
}

/** Queues a look at the session for the endpoint it reports to, if any. Never throws. */
export function queueWebhookEvents(sessionId: string, hint?: WebhookEvent): void {
  void (async () => {
    const target = await sessionWebhook(sessionId)

    if (!target) return
    const { teamId } = target
    const hook = await teamWebhooks().findOne(
      { _id: new ObjectId(target.webhookId), teamId, enabled: true },
      { projection: { _id: 1 } },
    )

    if (!hook) return
    const now = new Date()

    await webhookDeliveries().insertOne({
      _id: newEventId(),
      webhookId: hook._id,
      teamId,
      sessionId,
      ...(hint ? { hint } : {}),
      state: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(now.getTime() + SETTLE_MS),
      createdAt: now,
    })
  })().catch((error: unknown) => {
    logError('webhooks.queue_failed', error, { session_id: sessionId })
  })
}
