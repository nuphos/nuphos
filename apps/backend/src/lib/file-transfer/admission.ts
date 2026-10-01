import { MongoServerError } from 'mongodb'

import { AppError } from '@/lib/errors'
import { fileTransferAdmissions } from '@/models'

// Operational protection for the shared temporary store. Identical for every
// team: no paid tier, entitlement, wallet or upgrade path. Fixed UTC hours mean
// at most two windows can be consumed across an hour boundary.
export const TRANSFER_GROUPS_PER_HOUR = 60
export const TRANSFER_BYTES_PER_HOUR = 5 * 1024 * 1024 * 1024
const HOUR_MS = 60 * 60 * 1000

export async function admitFileTransfer(teamId: string, bytes: number, now = Date.now()) {
  const hour = Math.floor(now / HOUR_MS)
  const key = `${teamId}:${String(hour)}`
  const counters = fileTransferAdmissions()

  try {
    await counters.updateOne(
      { _id: key },
      { $setOnInsert: { count: 0, bytes: 0, expiresAt: new Date((hour + 2) * HOUR_MS) } },
      { upsert: true },
    )
  } catch (error) {
    // Another replica may insert the same unique _id concurrently.
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error
  }
  const result = await counters.updateOne(
    {
      _id: key,
      count: { $lt: TRANSFER_GROUPS_PER_HOUR },
      bytes: { $lte: TRANSFER_BYTES_PER_HOUR - bytes },
    },
    { $inc: { count: 1, bytes } },
  )

  if (result.modifiedCount !== 1) {
    throw new AppError(
      429,
      'file_transfer_rate_limited',
      'File transfers are temporarily limited for this team. Try again next hour.',
    )
  }
}
