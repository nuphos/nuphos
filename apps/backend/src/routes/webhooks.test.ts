import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useTriggerExecutor } from '@/lib/test/doubles/trigger-executor'

import type { AgentTrigger } from '@/lib/agent/trigger-db'

const SECRET = 'a'.repeat(64)
const fires: { trigger: AgentTrigger; payload: unknown; options: Record<string, unknown> }[] = []
let stored: AgentTrigger

useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(stored),
      // The flood-guard claim always wins here.
      findOneAndUpdate: () => Promise.resolve(stored),
    }),
  }),
})
useTriggerExecutor({
  executeTrigger: (trigger, payload, options) => {
    fires.push({ trigger, payload, options })

    return Promise.resolve('session')
  },
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

  test('no longer routes a stored session-routing row into its own session', async () => {
    stored = webhook({
      targetSessionId: undefined,
      sessionRouting: { keyTemplate: '{{payload.number}}' },
    })

    const res = await post({ number: 7 })

    // The executor pauses it; the route never answers with a routed session.
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('sessionId')
    expect(fires).toHaveLength(1)
  })

  test('still refuses a disabled Trigger without firing', async () => {
    stored = webhook({ enabled: false })

    const res = await post()

    expect(await res.json()).toMatchObject({ ok: false, reason: 'trigger_disabled' })
    expect(fires).toHaveLength(0)
  })
})
