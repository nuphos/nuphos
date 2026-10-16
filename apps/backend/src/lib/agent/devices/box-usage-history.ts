// A team's running Box vCPUs and its limit over time, for the Billing chart.
// instabox keeps no history, so every Box change the backend sees records the
// team's whole current use: a missed change is corrected by the next one, and
// the chart is a step function with no timer behind it.
import { db } from '@/lib/db'
import { QUOTA_HISTORY_RANGES } from '@/lib/claude-code-preview/runtime-quota-history'
import { logError } from '@/lib/observability'

import { teamBoxUsage, teamVcpuLimit } from './box-instabox-limit'

import type { QuotaHistoryRange } from '@/lib/claude-code-preview/runtime-quota-history'
import type { AgentDevice } from './store'
import type { Collection } from 'mongodb'

const RETENTION_SECONDS = 31 * 24 * 3600

export type BoxUsageReading = { usedVcpus: number; limitVcpus: number | null }
export type BoxUsagePoint = BoxUsageReading & { at: string }

type BoxUsageSampleDoc = BoxUsageReading & {
  /** `${teamId}:${minute}`: changes within a minute keep only the last reading. */
  _id: string
  teamId: string
  at: Date
}

const samples = (): Collection<BoxUsageSampleDoc> =>
  db().collection<BoxUsageSampleDoc>('box_usage_samples')

export async function setupBoxUsageHistoryIndexes(): Promise<void> {
  await samples().createIndex({ teamId: 1, at: 1 }, { name: 'box_usage_samples_team_at' })
  await samples().createIndex(
    { at: 1 },
    { expireAfterSeconds: RETENTION_SECONDS, name: 'box_usage_samples_ttl' },
  )
}

export function sampleId(teamId: string, at: Date): string {
  return `${teamId}:${at.toISOString().slice(0, 16)}`
}

async function readBoxUsage(teamId: string): Promise<BoxUsageReading> {
  const [{ usedVcpus }, { limit }] = await Promise.all([
    teamBoxUsage(teamId),
    teamVcpuLimit(teamId),
  ])

  return { usedVcpus, limitVcpus: limit ?? null }
}

/** Records the team's current use; never fails its caller. */
export function noteBoxUsage(teamId: string): void {
  const at = new Date()

  void readBoxUsage(teamId)
    .then((reading) =>
      samples().updateOne(
        { _id: sampleId(teamId, at) },
        { $set: { teamId, at, ...reading } },
        { upsert: true },
      ),
    )
    .catch((error: unknown) =>
      logError('agent.box.usage_sample_failed', error, { team_id: teamId }),
    )
}

/**
 * A Box's tunnel opens when it starts, resumes or wakes, and closes when it
 * pauses or stops, whoever did it: Nuphos, instabox's idle pause, a command
 * that woke it, a crash, a kill in instabox's console.
 */
export function noteBoxPresence(
  userId: string,
  deviceId: string,
  getDevice: (userId: string, deviceId: string) => Promise<AgentDevice | null>,
  note: (teamId: string) => void = noteBoxUsage,
): Promise<void> {
  return getDevice(userId, deviceId).then(
    (device) => {
      if (device?.box) note(device.box.teamId)
    },
    () => undefined,
  )
}

/**
 * The step series for [from, to]: the reading in force at `from`, then per
 * bucket the highest use (so a short peak shows) and the last limit, then `to`.
 */
export function stepSeries(
  prior: BoxUsageReading | null,
  rows: (BoxUsageReading & { at: Date })[],
  window: { from: number; to: number; bucketMinutes: number },
  live: BoxUsageReading | null,
): BoxUsagePoint[] {
  const bucketMs = window.bucketMinutes * 60_000
  const points: BoxUsagePoint[] = []

  if (prior) points.push({ at: new Date(window.from).toISOString(), ...prior })
  for (const row of rows) {
    const at = new Date(Math.floor(row.at.getTime() / bucketMs) * bucketMs).toISOString()
    const last = points.at(-1)

    if (last?.at === at) {
      last.usedVcpus = Math.max(last.usedVcpus, row.usedVcpus)
      last.limitVcpus = row.limitVcpus
    } else {
      points.push({ at, usedVcpus: row.usedVcpus, limitVcpus: row.limitVcpus })
    }
  }
  const end = live ?? points.at(-1)

  if (end)
    points.push({
      at: new Date(window.to).toISOString(),
      usedVcpus: end.usedVcpus,
      limitVcpus: end.limitVcpus,
    })

  return points
}

export async function listBoxUsageHistory(
  teamId: string,
  range: QuotaHistoryRange,
  nowMs = Date.now(),
) {
  const { hours, bucketMinutes } = QUOTA_HISTORY_RANGES[range]
  const from = nowMs - hours * 3_600_000
  const [prior, rows, live] = await Promise.all([
    samples()
      .find({ teamId, at: { $lt: new Date(from) } })
      .sort({ at: -1 })
      .limit(1)
      .next(),
    samples()
      .find({ teamId, at: { $gte: new Date(from) } })
      .sort({ at: 1 })
      .toArray(),
    // An instabox outage carries the last reading to now instead of failing the chart.
    readBoxUsage(teamId).catch(() => null),
  ])

  return {
    range,
    from: new Date(from).toISOString(),
    to: new Date(nowMs).toISOString(),
    points: stepSeries(prior, rows, { from, to: nowMs, bucketMinutes }, live),
  }
}
