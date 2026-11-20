import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { AgentTrigger } from '../trigger-db'

let stored: AgentTrigger | null = null

useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(stored),
      updateOne: (_filter: unknown, update: { $set: Partial<AgentTrigger> }) => {
        if (stored) stored = { ...stored, ...update.$set }

        return Promise.resolve({ matchedCount: stored ? 1 : 0 })
      },
    }),
  }),
})

const { rotateTriggerSecret } = await import('./rotate-secret')

const OLD = 'a'.repeat(64)

function trigger(overrides: Partial<AgentTrigger> = {}): AgentTrigger {
  return {
    _id: new ObjectId(),
    userId: 'owner',
    name: 'alert',
    triggerType: 'webhook',
    webhookSecret: OLD,
    messageTemplate: 'Look at {{payload}}',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('rotateTriggerSecret', () => {
  test('replaces the secret and returns the new one', async () => {
    stored = trigger()

    const secret = await rotateTriggerSecret(String(stored._id), 'owner')

    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(secret).not.toBe(OLD)
    expect(stored.webhookSecret).toBe(secret)
  })

  test('a Trigger without a webhook has no secret to rotate', async () => {
    stored = trigger({ triggerType: 'cron', cronExpression: '0 3 * * *', webhookSecret: undefined })

    await expect(rotateTriggerSecret(String(stored._id), 'owner')).rejects.toMatchObject({
      status: 400,
    })
  })

  test('someone who cannot manage the Trigger cannot rotate it', async () => {
    stored = trigger()

    await expect(rotateTriggerSecret(String(stored._id), 'someone-else')).rejects.toMatchObject({
      status: 404,
    })
    expect(stored.webhookSecret).toBe(OLD)
  })
})
