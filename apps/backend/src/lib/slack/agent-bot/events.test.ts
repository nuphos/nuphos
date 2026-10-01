import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

type EventDoc = {
  eventId: string
  status: 'processing' | 'completed' | 'failed' | 'ignored'
  processingExpiresAt?: Date
  updatedAt: Date
  [key: string]: unknown
}

let doc: EventDoc | null = null

const collection = {
  insertOne: async (value: EventDoc) => {
    if (doc?.eventId === value.eventId) throw Object.assign(new Error('duplicate'), { code: 11000 })
    doc = { ...value }

    return { acknowledged: true }
  },
  findOneAndUpdate: async () => null,
  updateOne: async (filter: Partial<EventDoc>, update: Record<string, Record<string, unknown>>) => {
    if (!doc || Object.entries(filter).some(([key, value]) => doc?.[key] !== value)) {
      return { matchedCount: 0 }
    }
    Object.assign(doc, update.$set ?? {})
    for (const key of Object.keys(update.$unset ?? {})) delete doc[key]

    return { matchedCount: 1 }
  },
}

useDb({ db: () => ({ collection: () => collection }) as never })

const { claimSlackEvent, markSlackEvent, refreshSlackEventClaim } = await import('./events')

beforeEach(() => {
  doc = null
})

describe('Slack event processing lease', () => {
  test('a live long-running handler renews the claim and duplicate delivery stays rejected', async () => {
    expect(await claimSlackEvent({ eventId: 'Ev-long' })).toBe(true)
    const before = doc?.processingExpiresAt?.getTime() ?? 0

    await refreshSlackEventClaim('Ev-long')

    expect(doc?.status).toBe('processing')
    expect(doc?.processingExpiresAt?.getTime()).toBeGreaterThanOrEqual(before)
    expect(await claimSlackEvent({ eventId: 'Ev-long' })).toBe(false)
  })

  test('a late heartbeat cannot resurrect a terminal event', async () => {
    await claimSlackEvent({ eventId: 'Ev-done' })
    await markSlackEvent('Ev-done', 'completed')
    const terminalUpdatedAt = doc?.updatedAt

    await refreshSlackEventClaim('Ev-done')

    expect(doc?.status).toBe('completed')
    expect(doc?.processingExpiresAt).toBeUndefined()
    expect(doc?.updatedAt).toBe(terminalUpdatedAt)
  })
})
