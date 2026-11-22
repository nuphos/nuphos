// The window claim and the hold, through real MongoDB updates.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { agentTriggers } from './trigger-db'
import { claimWindow } from './trigger-held-claim'

import type { AgentTrigger } from './trigger-db'

const _id = new ObjectId()
const trigger = { _id, minIntervalSeconds: 60 } as AgentTrigger
const held = () => agentTriggers().findOne({ _id })

describe.skipIf(!process.env.TEST_MONGODB_URI)('trigger held deliveries', () => {
  beforeAll(async () => {
    await connectDb()
    await agentTriggers().insertOne({ _id, minIntervalSeconds: 60 } as never)
  })
  afterAll(async () => {
    await agentTriggers().deleteOne({ _id })
    await closeDb()
  })

  test('the first delivery opens the window and fires as it came', async () => {
    expect(await claimWindow(trigger, { n: 1 })).toEqual({ payload: { n: 1 } })
  })

  test('a delivery inside the window waits for what is left of it', async () => {
    const claim = await claimWindow({ ...trigger, lastRunAt: (await held())!.lastRunAt }, { n: 2 })

    expect('waitSeconds' in claim && claim.waitSeconds).toBeGreaterThan(0)
  })

  test('the delivery that opens the next window takes what was held, once', async () => {
    await agentTriggers().updateOne(
      { _id },
      { $set: { lastRunAt: new Date(Date.now() - 61_000), heldDeliveries: [{ n: 2 }, { n: 3 }] } },
    )

    expect(await claimWindow(trigger, { n: 4 })).toEqual({
      payload: { coalesced: 3, deliveries: [{ n: 2 }, { n: 3 }, { n: 4 }] },
    })
    expect((await held())!.heldDeliveries).toBeUndefined()
  })
})
