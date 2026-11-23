import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { AppError, errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useTriggerExecutor } from '@/lib/test/doubles/trigger-executor'
import { useTriggerScheduler } from '@/lib/test/doubles/trigger-scheduler'

import type { AgentTrigger } from '@/lib/agent/trigger-db'

const SECRET = 'a'.repeat(64)
const fires: { trigger: AgentTrigger; payload: unknown; options: Record<string, unknown> }[] = []
let stored: AgentTrigger

let lastRunAt: Date | undefined
let refusal: Error | undefined
const held: unknown[] = []
const flushes: { triggerId: string; delayMs: number }[] = []
let queueUp = true

useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(stored),
      updateOne: () => {
        held.pop()

        return Promise.resolve({})
      },
      // The cooldown claim, as Mongo runs it: it wins only once its window has passed.
      findOneAndUpdate: (
        filter: { $or?: [unknown, { lastRunAt: { $lte: Date } }] },
        update: { $push?: { heldDeliveries: { $each: unknown[] } } },
      ) => {
        // The hold: pushes a delivery and returns the Trigger as it was before.
        if (update.$push) {
          const before = [...held]

          held.push(...update.$push.heldDeliveries.$each)

          return Promise.resolve({ heldDeliveries: before })
        }
        const cutoff = filter.$or![1].lastRunAt.$lte

        if (lastRunAt && lastRunAt > cutoff) return Promise.resolve(null)
        lastRunAt = new Date()

        // Taking the window takes what was held with it.
        return Promise.resolve({ ...stored, heldDeliveries: held.splice(0) })
      },
    }),
  }),
})
useTriggerScheduler({
  enqueueHeldFlush: (triggerId, delayMs) => {
    if (queueUp) flushes.push({ triggerId, delayMs })

    return Promise.resolve(queueUp)
  },
})
function fired(trigger: AgentTrigger, payload: unknown, options: Record<string, unknown>) {
  if (refusal) return Promise.reject(refusal)
  fires.push({ trigger, payload, options })

  return Promise.resolve({ sessionId: 'session', run: Promise.race([]) })
}
useTriggerExecutor({
  fireTrigger: fired,
  executeTrigger: (trigger, payload, options) =>
    fired(trigger, payload, options).then(({ sessionId }) => sessionId),
})
const { webhooksRoutes } = await import('./webhooks')
const app = new Hono().onError(errorHandler).route('/', webhooksRoutes)

function webhook(overrides: Partial<AgentTrigger> = {}): AgentTrigger {
  return {
    _id: new ObjectId(),
    userId: 'owner',
    teamId: 'team-1',
    name: 'alert',
    triggerType: 'webhook',
    messageTemplate: 'Look at {{payload}}',
    webhookSecret: SECRET,
    enabled: true,
    targetSessionId: 'bound-session',
    ...overrides,
  } as AgentTrigger
}

async function post(body: unknown = { status: 'firing' }, headers: Record<string, string> = {}) {
  return await app.request(`/${stored._id!.toHexString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Webhook-Secret': SECRET, ...headers },
    body: JSON.stringify(body),
  })
}

// Signed SNS envelope whose certificate URL is not an SNS host, so verification
// fails before any network fetch.
const unverifiableSnsEnvelope = {
  Type: 'Notification',
  MessageId: 'message-1',
  TopicArn: 'arn:aws:sns:us-east-1:123456789012:alerts',
  Message: '{"AlarmName":"High CPU","NewStateValue":"ALARM"}',
  Timestamp: '2026-07-23T10:00:00.000Z',
  SignatureVersion: '2',
  Signature: 'forged',
  SigningCertURL: 'https://example.test/SimpleNotificationService-x.pem',
}

beforeEach(() => {
  fires.length = 0
  lastRunAt = undefined
  refusal = undefined
  held.length = 0
  flushes.length = 0
  queueUp = true
})

describe('POST /webhooks/:triggerId', () => {
  test('delivers a bound Trigger through the executor with its payload', async () => {
    stored = webhook()

    const res = await post({ status: 'firing' })

    expect(res.status).toBe(200)
    expect(fires).toHaveLength(1)
    expect(fires[0]?.payload).toEqual({ status: 'firing' })
    expect(fires[0]?.options).toEqual({ runKind: 'webhook' })
  })

  test('rejects the secret before looking at the body', async () => {
    stored = webhook()

    const res = await app.request(`/${stored._id!.toHexString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Webhook-Secret': 'b'.repeat(64) },
      body: JSON.stringify(unverifiableSnsEnvelope),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_secret' } })
    expect(fires).toHaveLength(0)
  })

  test('delivers a generic payload with its own Type field unchanged', async () => {
    stored = webhook()

    const res = await post({ Type: 'Notification', status: 'firing' })

    expect(res.status).toBe(200)
    expect(fires[0]?.payload).toEqual({ Type: 'Notification', status: 'firing' })
  })

  test('treats a signed SNS envelope as SNS even without the header', async () => {
    stored = webhook()

    const res = await post(unverifiableSnsEnvelope)

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_sns_message' } })
    expect(fires).toHaveLength(0)
  })

  test('refuses an SNS header whose body is not a signed envelope', async () => {
    stored = webhook()

    const res = await post({ status: 'firing' }, { 'x-amz-sns-message-type': 'Notification' })

    expect(res.status).toBe(401)
    expect(fires).toHaveLength(0)
  })

  test('still refuses a disabled Trigger without firing', async () => {
    stored = webhook({ enabled: false })

    const res = await post()

    expect(await res.json()).toMatchObject({ ok: false, reason: 'trigger_disabled' })
    expect(fires).toHaveLength(0)
  })

  test('two alerts a few seconds apart both reach the Task, in order', async () => {
    stored = webhook()

    const firing = await post({ status: 'firing' })
    const resolved = await post({ status: 'resolved' })

    expect([firing.status, resolved.status]).toEqual([200, 200])
    expect(await resolved.json()).toEqual({ ok: true })
    expect(fires.map((fire) => fire.payload)).toEqual([
      { status: 'firing' },
      { status: 'resolved' },
    ])
  })

  test('answers only once the conversation has the delivery, and never while running it', async () => {
    stored = webhook()

    // fired()'s turn never finishes, so a response here means it did not wait for the run.
    const res = await post()

    expect(res.status).toBe(200)
    expect(fires).toHaveLength(1)
  })

  test('asks the sender to retry when the conversation cannot take the delivery', async () => {
    stored = webhook()
    refusal = new AppError(
      429,
      'conversation_queue_unavailable',
      'Thread message could not be queued.',
    )

    const res = await post()

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(await res.json()).toMatchObject({ ok: false, reason: 'conversation_queue_unavailable' })
  })

  test('a failed delivery is an error the sender sees, not an ok', async () => {
    stored = webhook()
    refusal = new Error('mongo is down')

    expect((await post()).status).toBe(500)
  })

  test.each([
    'trigger_target_session_invalid',
    'trigger_target_session_archived',
    'trigger_execution_principal_invalid',
  ])(
    'a Trigger paused by its own checks (%s) answers like a disabled one, not a 4xx',
    async (code) => {
      stored = webhook()
      refusal = new AppError(409, code, 'The Trigger was paused')

      const res = await post()

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: false, reason: code })
    },
  )

  test('any other conflict on the way is an error, not a delivery', async () => {
    stored = webhook()
    refusal = new AppError(409, 'turn_conflict', 'Another turn holds the conversation')

    expect((await post()).status).toBe(409)
  })

  test('a delivery inside the window is held and fired when the window ends', async () => {
    stored = webhook({ minIntervalSeconds: 300, lastRunAt: new Date(Date.now() - 120_000) })
    lastRunAt = stored.lastRunAt

    const res = await post({ action: 'synchronize' })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, held: true, firesInSeconds: 180 })
    expect(held).toEqual([{ action: 'synchronize' }])
    expect(flushes).toEqual([{ triggerId: String(stored._id), delayMs: 180_000 }])
    expect(fires).toHaveLength(0)
  })

  test('one flush is pending per batch: a second hold joins it, a hold after a flush starts the next', async () => {
    stored = webhook({ minIntervalSeconds: 300, lastRunAt: new Date(Date.now() - 120_000) })
    lastRunAt = stored.lastRunAt

    await post({ n: 1 })
    await post({ n: 2 })
    expect(flushes).toHaveLength(1)
    // The flush took the batch: what arrives next is not covered by the job that took it.
    held.length = 0
    await post({ n: 3 })
    expect(flushes).toHaveLength(2)
  })

  test('the delivery that opens the window fires with everything held before it', async () => {
    stored = webhook({ minIntervalSeconds: 300 })
    held.push({ n: 1 }, { n: 2 })

    expect((await post({ n: 3 })).status).toBe(200)
    expect(fires.map((f) => f.payload)).toEqual([
      { coalesced: 3, deliveries: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    ])
  })

  test('a single delivery fires as it came', async () => {
    stored = webhook({ minIntervalSeconds: 300 })

    expect((await post({ n: 1 })).status).toBe(200)
    expect(fires.map((f) => f.payload)).toEqual([{ n: 1 }])
  })

  test('asks the sender to come back when nothing can fire the held delivery', async () => {
    stored = webhook({ minIntervalSeconds: 300, lastRunAt: new Date(Date.now() - 120_000) })
    lastRunAt = stored.lastRunAt
    queueUp = false

    const res = await post()

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('180')
    expect(held).toHaveLength(0)
  })
})

describe('payload filters', () => {
  const filters = [{ path: 'action', in: ['opened', 'synchronize'] }]

  test('a delivery that fails the rules is answered and starts no turn', async () => {
    stored = webhook({ payloadFilters: filters })

    const skipped = await post({ action: 'labeled' })

    expect(skipped.status).toBe(200)
    expect(await skipped.json()).toEqual({ ok: true, skipped: true, reason: 'filtered' })
    expect(fires).toHaveLength(0)
  })

  test('a delivery that passes them fires once', async () => {
    stored = webhook({ payloadFilters: filters })

    expect((await post({ action: 'synchronize' })).status).toBe(200)
    expect(fires).toHaveLength(1)
  })

  test('a filtered delivery does not use up the cooldown', async () => {
    stored = webhook({ payloadFilters: filters, minIntervalSeconds: 300 })

    await post({ action: 'edited' })
    expect((await post({ action: 'opened' })).status).toBe(200)
    expect(fires).toHaveLength(1)
  })
})
