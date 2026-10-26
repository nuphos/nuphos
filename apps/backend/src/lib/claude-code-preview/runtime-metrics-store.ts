import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { BoxMetrics } from '@/lib/agent/devices/metrics-schema'
import type { Collection } from 'mongodb'

export const RUNTIME_METRIC_SAMPLE_INTERVAL_MS = 30_000
const RUNTIME_METRIC_RETENTION_SECONDS = 7 * 24 * 3600

export type RuntimeMetricSampleDoc = {
  /** `${runtimeId}:${bucket}` — one row per runtime per sampling interval, so
   *  every backend replica sampling the same pod converges on one document. */
  _id: string
  /** Absent on a computer's rows: a computer belongs to its owner, not to a team. */
  teamId?: string
  runtimeId: string
  at: Date
  /** Null when the runtime did not report one. */
  cpuMillicores: number | null
  /** The share of the whole machine a computer reports, in place of millicores. */
  cpuPercent?: number | null
  memoryBytes: number | null
  memoryTotalBytes?: number | null
  /** Conversations attached to the runtime right now, as its session inventory reports. */
  sessions: number | null
  /** Capacity and usage of the volumes the runtime reports. Null when there was no reading. */
  diskTotalBytes: number | null
  diskUsedBytes: number | null
}

export type RuntimeMetricSample = {
  at: string
  cpuMillicores: number | null
  cpuPercent: number | null
  memoryBytes: number | null
  memoryTotalBytes: number | null
  sessions: number | null
  diskTotalBytes: number | null
  diskUsedBytes: number | null
}

export const runtimeMetricSamples = (): Collection<RuntimeMetricSampleDoc> =>
  db().collection<RuntimeMetricSampleDoc>('agent_runtime_metric_samples')

export async function setupRuntimeMetricIndexes(): Promise<void> {
  // Runtime ids are unique on their own, and a computer's rows carry no team.
  await runtimeMetricSamples().createIndex(
    { runtimeId: 1, at: 1 },
    { name: 'agent_runtime_metric_samples_runtime_at' },
  )
  try {
    await runtimeMetricSamples().dropIndex('agent_runtime_metric_samples_scope_at')
  } catch (err) {
    if ((err as { codeName?: string }).codeName !== 'IndexNotFound') throw err
  }
  await runtimeMetricSamples().createIndex(
    { at: 1 },
    {
      expireAfterSeconds: RUNTIME_METRIC_RETENTION_SECONDS,
      name: 'agent_runtime_metric_samples_ttl',
    },
  )
}

export function sampleBucket(nowMs: number): Date {
  return new Date(
    Math.floor(nowMs / RUNTIME_METRIC_SAMPLE_INTERVAL_MS) * RUNTIME_METRIC_SAMPLE_INTERVAL_MS,
  )
}

export async function recordRuntimeMetricSample(
  sample: Omit<RuntimeMetricSampleDoc, '_id'>,
): Promise<void> {
  await runtimeMetricSamples().updateOne(
    { _id: `${sample.runtimeId}:${String(sample.at.getTime())}` },
    { $set: sample },
    { upsert: true },
  )
}

/** Where a computer's own reports are kept: one series per computer, whichever agents it runs. */
export function deviceMetricsRuntimeId(userId: string, deviceId: string): string {
  return localRuntimeId({ userId, deviceId, provider: 'claude-code' })
}

/** Keeps the first report in each sampling interval; the host sends one every few seconds. */
export function recordDeviceMetricSample(
  userId: string,
  deviceId: string,
  metrics: BoxMetrics,
  nowMs = Date.now(),
): void {
  const runtimeId = deviceMetricsRuntimeId(userId, deviceId)
  const at = sampleBucket(nowMs)
  const sample: Omit<RuntimeMetricSampleDoc, '_id'> = {
    runtimeId,
    at,
    cpuMillicores: null,
    cpuPercent: metrics.cpuPercent,
    memoryBytes: metrics.memory.used,
    memoryTotalBytes: metrics.memory.total,
    sessions: null,
    diskTotalBytes: metrics.disk.total,
    diskUsedBytes: metrics.disk.used,
  }

  void runtimeMetricSamples()
    .updateOne(
      { _id: `${runtimeId}:${String(at.getTime())}` },
      { $setOnInsert: sample },
      { upsert: true },
    )
    .catch((err: unknown) => {
      logError('agent.local_runtime.metrics_record_failed', err, { device_id: deviceId })
    })
}

/** The caller checks access: this reads by runtime id alone. */
export async function listRuntimeMetricSamples(
  runtimeId: string,
  sinceMs: number,
): Promise<RuntimeMetricSample[]> {
  const docs = await runtimeMetricSamples()
    .find({ runtimeId, at: { $gte: new Date(sinceMs) } })
    .sort({ at: 1 })
    .toArray()

  return docs.map((doc) => ({
    at: doc.at.toISOString(),
    cpuMillicores: doc.cpuMillicores,
    // Only a computer's rows carry these.
    cpuPercent: doc.cpuPercent ?? null,
    memoryBytes: doc.memoryBytes,
    memoryTotalBytes: doc.memoryTotalBytes ?? null,
    sessions: doc.sessions,
    // Rows written before disk sampling existed carry neither field.
    diskTotalBytes: doc.diskTotalBytes ?? null,
    diskUsedBytes: doc.diskUsedBytes ?? null,
  }))
}
