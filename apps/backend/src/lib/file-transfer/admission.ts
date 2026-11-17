import { MongoServerError } from 'mongodb'

import { AppError } from '@/lib/errors'
import { fileTransferAdmissions } from '@/models'

// Operational protection for the shared temporary store. Identical for every
// team: no paid tier, entitlement, wallet or upgrade path. Fixed UTC hours mean
// at most two windows can be consumed across an hour boundary.
export const TRANSFER_GROUPS_PER_HOUR = 60
export const TRANSFER_BYTES_PER_HOUR = 5 * 1024 * 1024 * 1024
const HOUR_MS = 60 * 60 * 1000

/** What one admitted transfer took, so a transfer that fails can give it back. */
export type AdmittedTransfer = { key: string; bytes: number }

export async function admitFileTransfer(
  teamId: string,
  bytes: number,
  now = Date.now(),
): Promise<AdmittedTransfer> {
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

  return { key, bytes }
}

/**
 * Gives back what a transfer that never delivered its file took. The filter
 * keeps the counters from going below zero; the caller makes sure one transfer
 * is refunded at most once. The key, not the current hour, picks the counter, so
 * an upload that crosses an hour boundary refunds the hour that admitted it.
 */
export async function refundFileTransfer({ key, bytes }: AdmittedTransfer): Promise<void> {
  await fileTransferAdmissions().updateOne(
    { _id: key, count: { $gte: 1 }, bytes: { $gte: bytes } },
    { $inc: { count: -1, bytes: -bytes } },
  )
}
