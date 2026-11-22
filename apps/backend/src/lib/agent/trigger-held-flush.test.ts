import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useTriggerExecutor } from '@/lib/test/doubles/trigger-executor'

import type { AgentTrigger } from './trigger-db'

let stored: Partial<AgentTrigger> | undefined
let windowOpen = true
const fires: unknown[] = []
const reflushes: number[] = []

useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(stored),
      findOneAndUpdate: () => Promise.resolve(windowOpen ? stored : null),
    }),
  }),
})
useTriggerExecutor({
  fireTrigger: (_trigger, payload) => {
    fires.push(payload)

    return Promise.resolve({ sessionId: 's', run: Promise.resolve() })
  },
})
const enqueue = (delayMs: number) => {
  reflushes.push(delayMs)

  return Promise.resolve(true)
}
const { flushHeldDeliveries } = await import('./trigger-held-flush')

function held(heldDeliveries: unknown[], enabled = true): Partial<AgentTrigger> {
  return { _id: new ObjectId(), enabled, minIntervalSeconds: 60, heldDeliveries }
}

beforeEach(() => {
  fires.length = 0
  reflushes.length = 0
  windowOpen = true
})

describe('flushHeldDeliveries', () => {
  test('fires everything held as one delivery', async () => {
    stored = held([{ n: 1 }, { n: 2 }])
    await flushHeldDeliveries(String(stored._id), enqueue)

    expect(fires).toEqual([{ coalesced: 2, deliveries: [{ n: 1 }, { n: 2 }] }])
  })

  test('fires a single held delivery as it came', async () => {
    stored = held([{ n: 1 }])
    await flushHeldDeliveries(String(stored._id), enqueue)

    expect(fires).toEqual([{ n: 1 }])
  })

  test('does nothing when nothing is held or the Trigger is off', async () => {
    stored = held([])
    await flushHeldDeliveries(String(stored._id), enqueue)
    stored = held([{ n: 1 }], false)
    await flushHeldDeliveries(String(stored._id), enqueue)

    expect(fires).toEqual([])
  })

  test('waits again if the window has not opened', async () => {
    stored = { ...held([{ n: 1 }]), lastRunAt: new Date() }
    windowOpen = false
    await flushHeldDeliveries(String(stored._id), enqueue)

    expect(fires).toEqual([])
    expect(reflushes).toHaveLength(1)
  })
})
