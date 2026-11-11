import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useTriggerExecutor } from '@/lib/test/doubles/trigger-executor'
import { useTriggerGroupService } from '@/lib/test/doubles/trigger-group-service'

import type { AgentTrigger } from '@/lib/agent/trigger-db'
import type { TriggerGroupMember } from '@/lib/agent/trigger-group-db'

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
    fires.push({ trigger, payload, options: options as Record<string, unknown> })

    return Promise.resolve('session')
  },
})
const member = { key: 'cpu', provider: 'grafana' } as TriggerGroupMember

useTriggerGroupService({
  matchTriggerGroupMembers: () => Promise.resolve([{ member, payload: { member: 'cpu' } }]),
  claimTriggerGroupMemberRun: () => Promise.resolve(true),
})

const { webhooksRoutes } = await import('./webhooks')

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

async function post(body: unknown = { status: 'firing' }) {
  return await webhooksRoutes.request(`/${stored._id!.toHexString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Webhook-Secret': SECRET },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  fires.length = 0
})

describe('POST /webhooks/:triggerId', () => {
  test('delivers a bound Watch through the executor with its payload', async () => {
    stored = webhook()

    const res = await post({ status: 'firing' })

    expect(res.status).toBe(200)
    expect(fires).toHaveLength(1)
    expect(fires[0]?.payload).toEqual({ status: 'firing' })
    expect(fires[0]?.options).toEqual({ runKind: 'webhook' })
  })

  test('fans a Watch Group delivery out per matched member', async () => {
    stored = webhook({ watchGroupId: new ObjectId() })

    const res = await post()

    expect(await res.json()).toMatchObject({ ok: true, matched: 1, accepted: 1 })
    expect(fires).toHaveLength(1)
    expect(fires[0]?.options).toEqual({ groupMember: member, runKind: 'webhook' })
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

  test('still refuses a disabled Watch without firing', async () => {
    stored = webhook({ enabled: false })

    const res = await post()

    expect(await res.json()).toMatchObject({ ok: false, reason: 'trigger_disabled' })
    expect(fires).toHaveLength(0)
  })
})
