import { beforeEach, expect, test } from 'bun:test'
import { MongoServerError } from 'mongodb'

import {
  admitFileTransfer,
  refundFileTransfer,
  TRANSFER_BYTES_PER_HOUR,
  TRANSFER_GROUPS_PER_HOUR,
} from './admission'

import { useModels } from '@/lib/test/doubles/models'

const buckets = new Map<string, { count: number; bytes: number }>()
let insertRace = false
let unavailable = false

useModels({
  fileTransferAdmissions: () => ({
    updateOne: async (
      filter: {
        _id: string
        count?: { $lt?: number; $gte?: number }
        bytes?: { $lte?: number; $gte?: number }
      },
      update: { $setOnInsert?: unknown; $inc?: { count: number; bytes: number } },
    ) => {
      if (unavailable) throw new Error('storage unavailable')
      if (update.$setOnInsert) {
        if (!buckets.has(filter._id)) buckets.set(filter._id, { count: 0, bytes: 0 })
        if (insertRace) throw new MongoServerError({ code: 11000, message: 'duplicate' })

        return { modifiedCount: 0 }
      }
      if (!filter.count || !filter.bytes || !update.$inc) throw new Error('invalid reservation')
      const state = buckets.get(filter._id)

      if (!state) return { modifiedCount: 0 }
      if (update.$inc.count < 0) {
        if (state.count < filter.count.$gte! || state.bytes < filter.bytes.$gte!)
          return { modifiedCount: 0 }
      } else if (state.count >= filter.count.$lt! || state.bytes > filter.bytes.$lte!)
        return { modifiedCount: 0 }
      state.count += update.$inc.count
      state.bytes += update.$inc.bytes

      return { modifiedCount: 1 }
    },
  }),
})

beforeEach(() => {
  buckets.clear()
  insertRace = false
  unavailable = false
})

test('concurrent reservations stop at the shared team limit', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: TRANSFER_GROUPS_PER_HOUR + 10 }, () => admitFileTransfer('team', 1, 0)),
  )

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
    TRANSFER_GROUPS_PER_HOUR,
  )
  await expect(admitFileTransfer('team', 1, 0)).rejects.toMatchObject({ status: 429 })
  await expect(admitFileTransfer('other-team', 1, 0)).resolves.toEqual({
    key: 'other-team:0',
    bytes: 1,
  })
  await expect(admitFileTransfer('team', 1, 3600000)).resolves.toEqual({ key: 'team:1', bytes: 1 })
})

test('reserves bytes before URLs can be issued and leaves rejected reservations unchanged', async () => {
  await admitFileTransfer('team', TRANSFER_BYTES_PER_HOUR, 0)
  await expect(admitFileTransfer('team', 1, 0)).rejects.toMatchObject({ status: 429 })
  expect(buckets.get('team:0')).toEqual({ count: 1, bytes: TRANSFER_BYTES_PER_HOUR })
})

test('handles an upsert race but fails closed on storage failure', async () => {
  insertRace = true
  await expect(admitFileTransfer('team', 1, 0)).resolves.toEqual({ key: 'team:0', bytes: 1 })
  unavailable = true
  await expect(admitFileTransfer('team', 1, 0)).rejects.toThrow('storage unavailable')
})

test('a refund gives back one transfer and its bytes, never below zero', async () => {
  const admitted = await admitFileTransfer('team', 10, 0)

  await admitFileTransfer('team', 5, 0)
  await refundFileTransfer(admitted)
  expect(buckets.get('team:0')).toEqual({ count: 1, bytes: 5 })
  await refundFileTransfer(admitted)
  expect(buckets.get('team:0')).toEqual({ count: 1, bytes: 5 })
})

test('a refund frees a slot at the limit', async () => {
  const admitted = await Promise.all(
    Array.from({ length: TRANSFER_GROUPS_PER_HOUR }, () => admitFileTransfer('team', 1, 0)),
  )

  await expect(admitFileTransfer('team', 1, 0)).rejects.toMatchObject({ status: 429 })
  await refundFileTransfer(admitted[0]!)
  await expect(admitFileTransfer('team', 1, 0)).resolves.toEqual({ key: 'team:0', bytes: 1 })
})
