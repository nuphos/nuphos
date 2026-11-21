import { randomInt } from 'node:crypto'

import { MongoServerError } from 'mongodb'

import { decryptWebhookSecret } from '@/lib/byos/secrets'
import { getTeamMembership } from '@/lib/identity'
import { OutboundBlockedError, pinnedFetch } from '@/lib/net/safe-outbound'
import { logError } from '@/lib/observability'
import { sessionNotification } from '@/routes/mcp/notifications'

import { teamWebhooks, webhookDeliveries } from './store'

import type { TeamWebhook, WebhookAttempt, WebhookDelivery, WebhookEvent } from './store'

const TICK_MS = 2_000
const BATCH = 10
/** How long a worker holds a claimed delivery before another may take it. */
const CLAIM_MS = 60_000
const TIMEOUT_MS = 10_000

/** An endpoint that keeps failing one event for this long is switched off. */
export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000
const FIRST_RETRY_MS = 10_000
const MAX_RETRY_MS = 60 * 60 * 1000

const STATUS_EVENTS: Partial<Record<string, WebhookEvent>> = {
  completed: 'session.turn.completed',
  failed: 'session.turn.failed',
  waiting_for_input: 'session.input_required',
}

export type SendResult = WebhookAttempt & { retry: boolean }

/** POSTs one event; only a 2xx counts as delivered. */
export async function sendWebhook(
  hook: Pick<TeamWebhook, 'url' | 'headers'>,
  id: string,
  body: string,
): Promise<SendResult> {
  const at = new Date()
  const headers = new Headers()

  for (const header of hook.headers) headers.set(header.name, decryptWebhookSecret(header.value))
  headers.set('content-type', 'application/json')
  headers.set('user-agent', 'Nuphos-Webhooks/1.0')
  headers.set('webhook-id', id)
  headers.set('webhook-timestamp', String(Math.floor(at.getTime() / 1000)))
  try {
    const res = await pinnedFetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    await res.body?.cancel()
    if (res.ok) return { at, status: res.status, ok: true, retry: false }

    return {
      at,
      status: res.status,
      ok: false,
      error: `HTTP ${String(res.status)}`,
      retry: res.status >= 500 || res.status === 408 || res.status === 429,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const refused = error instanceof OutboundBlockedError && error.status === 400

    return { at, status: null, ok: false, error: message.slice(0, 200), retry: !refused }
  }
}

/** The payload for this delivery, or why it is not sent. */
async function prepare(
  hook: TeamWebhook,
  delivery: WebhookDelivery,
): Promise<{ type: WebhookEvent; stateHash: string; body: string } | string> {
  const membership = await getTeamMembership(hook.createdBy, hook.teamId)

  if (membership?.role !== 'ADMINISTRATOR')
    return 'The endpoint creator is no longer a team administrator.'
  const state = await sessionNotification(delivery.sessionId, hook.createdBy)

  if (!state) return 'The endpoint creator cannot read this session.'
  const { params } = state.notification
  const type = delivery.hint ?? STATUS_EVENTS[String(params.status)]

  if (!type) return 'The session is still running.'
  if (!hook.events.includes(type)) return 'Not subscribed.'

  return {
    type,
    stateHash: state.id,
    body: JSON.stringify({
      id: delivery._id,
      type,
      created_at: delivery.createdAt.toISOString(),
      team_id: hook.teamId,
      data: {
        ...params,
        next: {
          check: { tool: 'nuphos_check', session_id: delivery.sessionId },
          reply: { tool: 'nuphos_ask', session_id: delivery.sessionId },
        },
      },
    }),
  }
}

const isDuplicateKey = (error: unknown) => error instanceof MongoServerError && error.code === 11000

function retryDelay(attempts: number): number {
  const base = Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS)

  return Math.round((base * (80 + randomInt(41))) / 100)
}

async function settle(
  delivery: WebhookDelivery,
  state: WebhookDelivery['state'],
  lastError?: string,
) {
  await webhookDeliveries().updateOne(
    { _id: delivery._id },
    { $set: { state, ...(lastError ? { lastError } : {}) } },
  )
}

/** The payload frozen on the first attempt; null when the delivery is skipped instead. */
async function payloadOf(
  hook: TeamWebhook,
  delivery: WebhookDelivery,
): Promise<{ type: WebhookEvent; body: string } | null> {
  if (delivery.type && delivery.body) return { type: delivery.type, body: delivery.body }
  const prepared = await prepare(hook, delivery)

  if (typeof prepared === 'string') {
    await settle(delivery, 'skipped', prepared)

    return null
  }
  try {
    await webhookDeliveries().updateOne({ _id: delivery._id }, { $set: prepared })
  } catch (error) {
    if (!isDuplicateKey(error)) throw error
    await settle(delivery, 'skipped', 'This state was already announced.')

    return null
  }

  return prepared
}

async function recordFailure(
  hook: TeamWebhook,
  delivery: WebhookDelivery,
  result: SendResult,
  now: Date,
): Promise<void> {
  const attempts = delivery.attempts + 1
  const lastError = result.error ?? 'Delivery failed.'
  const expired = now.getTime() - delivery.createdAt.getTime() >= RETRY_WINDOW_MS

  if (result.retry && !expired) {
    await webhookDeliveries().updateOne(
      { _id: delivery._id },
      {
        $set: {
          attempts,
          lastError,
          nextAttemptAt: new Date(now.getTime() + retryDelay(attempts)),
        },
      },
    )

    return
  }
  await webhookDeliveries().updateOne(
    { _id: delivery._id },
    { $set: { state: 'failed', attempts, lastError } },
  )
  // 410 Gone asks us to stop; a day of failures means nobody is listening.
  if (result.status === 410 || result.retry)
    await teamWebhooks().updateOne(
      { _id: hook._id },
      {
        $set: {
          enabled: false,
          disabledReason:
            result.status === 410
              ? 'The endpoint answered 410 Gone.'
              : 'Deliveries kept failing for 24 hours.',
        },
      },
    )
}

async function attempt(delivery: WebhookDelivery, now: Date): Promise<void> {
  const hook = await teamWebhooks().findOne({ _id: delivery.webhookId })

  if (!hook?.enabled) {
    await settle(delivery, 'skipped', 'The endpoint is disabled.')

    return
  }
  const payload = await payloadOf(hook, delivery)

  if (!payload) return
  const result = await sendWebhook(hook, delivery._id, payload.body)
  const { retry: _retry, ...lastDelivery } = result

  await teamWebhooks().updateOne(
    { _id: hook._id },
    { $set: { lastDelivery: { ...lastDelivery, type: payload.type } } },
  )
  if (result.ok) await settle(delivery, 'delivered')
  else await recordFailure(hook, delivery, result, now)
}

/** Claims and attempts up to one batch of due deliveries; returns how many it took. */
export async function deliverDueWebhooks(now = new Date()): Promise<number> {
  const claimed: WebhookDelivery[] = []

  while (claimed.length < BATCH) {
    const delivery = await webhookDeliveries().findOneAndUpdate(
      { state: 'pending', nextAttemptAt: { $lte: now } },
      { $set: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) } },
      { sort: { nextAttemptAt: 1 } },
    )

    if (!delivery) break
    claimed.push(delivery)
  }
  await Promise.all(
    claimed.map((delivery) =>
      attempt(delivery, now).catch(async (error: unknown) => {
        logError('webhooks.delivery_failed', error, { delivery_id: delivery._id })
        await settle(delivery, 'failed', 'Internal error.').catch(() => null)
      }),
    ),
  )

  return claimed.length
}

export function startWebhookDelivery(): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      let taken = BATCH

      while (taken === BATCH) taken = await deliverDueWebhooks()
    } catch (error) {
      logError('webhooks.tick_failed', error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), TICK_MS)

  timer.unref()

  return () => {
    clearInterval(timer)
  }
}
