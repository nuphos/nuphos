import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { AgentTrigger } from '../trigger-db'

let stored: AgentTrigger

useDb({
  db: () => ({ collection: () => ({ findOne: () => Promise.resolve(stored) }) }),
})

const { getTrigger } = await import('./read')

describe('getTrigger', () => {
  test('does not return the webhook secret, even to its owner', async () => {
    stored = {
      _id: new ObjectId(),
      userId: 'owner',
      name: 'alert',
      triggerType: 'webhook',
      webhookSecret: 'a'.repeat(64),
      messageTemplate: 'Look at {{payload}}',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const read = await getTrigger(String(stored._id), 'owner')

    expect(read.canManage).toBe(true)
    expect(JSON.stringify(read)).not.toContain('a'.repeat(64))
    expect('webhookSecret' in read).toBe(false)
  })
})
