import { ObjectId } from 'mongodb'

import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type { AgentTrigger } from '../trigger-db'

let stored: Record<string, unknown> | null = null

useDb({
  db: () =>
    ({
      collection: () => ({ findOne: () => Promise.resolve(stored) }),
    }) as never,
})

const { findManagedTrigger } = await import('./shared')

const base = {
  _id: new ObjectId(),
  userId: 'u1',
  name: 'nightly',
  triggerType: 'cron',
  cronExpression: '0 3 * * *',
  messageTemplate: 'check',
  enabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('findManagedTrigger', () => {
  test('returns a live trigger', async () => {
    stored = base
    expect(((await findManagedTrigger(base._id)) as AgentTrigger).name).toBe('nightly')
  })

  test('reads retired database-alert rows as missing', async () => {
    for (const retired of [
      { ...base, triggerType: 'database-alert' },
      { ...base, databaseAlert: { metric: 'queue-depth' } },
    ]) {
      stored = retired
      await expect(findManagedTrigger(base._id)).rejects.toMatchObject({ status: 404 })
    }
  })

  test('a missing row is a 404', async () => {
    stored = null
    await expect(findManagedTrigger(base._id)).rejects.toMatchObject({ status: 404 })
  })
})
