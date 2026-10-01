import { db } from '@/lib/db'

import type { Collection } from 'mongodb'

export const RUNTIME_METRIC_SAMPLE_INTERVAL_MS = 30_000
const RUNTIME_METRIC_RETENTION_SECONDS = 7 * 24 * 3600

export type RuntimeMetricSampleDoc = {
  /** `${runtimeId}:${bucket}` — one row per runtime per sampling interval, so
   *  every backend replica sampling the same pod converges on one document. */
  _id: string
  teamId: string
  runtimeId: string
  at: Date
  /** Null when the runtime did not report one. */
  cpuMillicores: number | null
  memoryBytes: number | null
  /** Conversations attached to the runtime right now, as its session inventory reports. */
  sessions: number | null
  /** Capacity and usage of the volumes the runtime reports. Null when there was no reading. */
  diskTotalBytes: number | null
  diskUsedBytes: number | null
}

export type RuntimeMetricSample = {
  at: string
  cpuMillicores: number | null
  memoryBytes: number | null
  sessions: number | null
  diskTotalBytes: number | null
  diskUsedBytes: number | null
}

export const runtimeMetricSamples = (): Collection<RuntimeMetricSampleDoc> =>
  db().collection<RuntimeMetricSampleDoc>('agent_runtime_metric_samples')

export async function setupRuntimeMetricIndexes(): Promise<void> {
  await runtimeMetricSamples().createIndex(
    { teamId: 1, runtimeId: 1, at: 1 },
    { name: 'agent_runtime_metric_samples_scope_at' },
  )
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

export async function listRuntimeMetricSamples(
  teamId: string,
  runtimeId: string,
  sinceMs: number,
): Promise<RuntimeMetricSample[]> {
  const docs = await runtimeMetricSamples()
    .find({ teamId, runtimeId, at: { $gte: new Date(sinceMs) } })
    .sort({ at: 1 })
    .toArray()

  return docs.map((doc) => ({
    at: doc.at.toISOString(),
    cpuMillicores: doc.cpuMillicores,
    memoryBytes: doc.memoryBytes,
    sessions: doc.sessions,
    // Rows written before disk sampling existed carry neither field.
    diskTotalBytes: doc.diskTotalBytes ?? null,
    diskUsedBytes: doc.diskUsedBytes ?? null,
  }))
}
