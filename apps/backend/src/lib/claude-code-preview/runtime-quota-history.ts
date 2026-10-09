// How much of each agent's subscription was used over time. Every reading a
// provider actually answers is kept as one row, so the history costs the
// provider nothing beyond the reads the agent page already makes.
import { db } from '@/lib/db'

import type { RuntimeQuota } from './runtime-quota-shape'
import type { Collection } from 'mongodb'

const RETENTION_SECONDS = 31 * 24 * 3600

export const QUOTA_HISTORY_RANGES = {
  '1d': { hours: 24, bucketMinutes: 10 },
  '7d': { hours: 24 * 7, bucketMinutes: 60 },
  '30d': { hours: 24 * 30, bucketMinutes: 360 },
} as const
export type QuotaHistoryRange = keyof typeof QUOTA_HISTORY_RANGES

type QuotaSampleDoc = {
  /** `${runtimeId}:${at}` — a reading served from cache is the same row again. */
  _id: string
  runtimeId: string
  at: Date
  windows: { id: string; label: string; usedPercent: number }[]
}

export type QuotaHistorySeries = {
  runtimeId: string
  windowId: string
  label: string
  /** The highest use seen in each bucket, oldest first. */
  points: { at: string; usedPercent: number }[]
}

const samples = (): Collection<QuotaSampleDoc> =>
  db().collection<QuotaSampleDoc>('agent_runtime_quota_samples')

export async function setupRuntimeQuotaHistoryIndexes(): Promise<void> {
  await samples().createIndex(
    { runtimeId: 1, at: 1 },
    { name: 'agent_runtime_quota_samples_runtime_at' },
  )
  await samples().createIndex(
    { at: 1 },
    { expireAfterSeconds: RETENTION_SECONDS, name: 'agent_runtime_quota_samples_ttl' },
  )
}

export async function recordRuntimeQuotaSample(quota: RuntimeQuota): Promise<void> {
  if (!quota.available) return
  await samples().updateOne(
    { _id: `${quota.runtimeId}:${quota.fetchedAt}` },
    {
      $setOnInsert: {
        runtimeId: quota.runtimeId,
        at: new Date(quota.fetchedAt),
        windows: quota.windows.map(({ id, label, usedPercent }) => ({ id, label, usedPercent })),
      },
    },
    { upsert: true },
  )
}

export async function listRuntimeQuotaHistory(
  runtimeIds: string[],
  range: QuotaHistoryRange,
  nowMs = Date.now(),
): Promise<QuotaHistorySeries[]> {
  const { hours, bucketMinutes } = QUOTA_HISTORY_RANGES[range]
  const rows = await samples()
    .aggregate<{
      _id: { runtimeId: string; windowId: string; at: Date }
      label: string
      usedPercent: number
    }>([
      {
        $match: {
          runtimeId: { $in: runtimeIds },
          at: { $gte: new Date(nowMs - hours * 3_600_000) },
        },
      },
      { $sort: { at: 1 } },
      { $unwind: '$windows' },
      {
        $group: {
          _id: {
            runtimeId: '$runtimeId',
            windowId: '$windows.id',
            at: { $dateTrunc: { date: '$at', unit: 'minute', binSize: bucketMinutes } },
          },
          label: { $last: '$windows.label' },
          usedPercent: { $max: '$windows.usedPercent' },
        },
      },
      { $sort: { '_id.at': 1 } },
    ])
    .toArray()
  const series = new Map<string, QuotaHistorySeries>()

  for (const row of rows) {
    const key = `${row._id.runtimeId}\0${row._id.windowId}`
    const entry = series.get(key) ?? {
      runtimeId: row._id.runtimeId,
      windowId: row._id.windowId,
      label: row.label,
      points: [],
    }

    entry.label = row.label
    entry.points.push({ at: row._id.at.toISOString(), usedPercent: row.usedPercent })
    series.set(key, entry)
  }

  return [...series.values()]
}
