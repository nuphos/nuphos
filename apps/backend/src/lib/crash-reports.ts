// Native crash reports from Nuphos Desktop: Electron's crashReporter (Crashpad)
// uploads a minidump as multipart/form-data. The raw dump and a small metadata
// object go to the Zeabur-owned S3 store under `crash-reports/`, so a crash can
// be symbolicated later against Electron's public symbols for that version.
// Only allowlisted, non-identifying fields are kept.
import { createHash, randomUUID } from 'node:crypto'

import { PutObjectCommand } from '@aws-sdk/client-s3'

import { config } from '@/config'
import { consumePairQuota } from '@/lib/download-handoff-rate-limit'
import { AppError } from '@/lib/errors'
import { capture } from '@/lib/posthog'
import { makeS3Client } from '@/lib/storage/s3-client'

import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'

export const CRASH_REPORT_MAX_BYTES = 10 * 1024 * 1024
// Crashpad on the client already uploads at most one report per hour.
const DEVICE_LIMIT = 10
const IP_LIMIT = 50
const WINDOW_SECONDS = 24 * 60 * 60

export type CrashReportMetadata = {
  electronVersion?: string
  appVersion?: string
  platform?: string
  arch?: string
  processType?: string
  heapUsedMb?: number
  heapLimitMb?: number
  uptimeSeconds?: number
}

const TEXT_FIELDS = {
  ver: 'electronVersion',
  _version: 'appVersion',
  platform: 'platform',
  arch: 'arch',
  process_type: 'processType',
} as const
const NUMBER_FIELDS = {
  heap_used_mb: 'heapUsedMb',
  heap_limit_mb: 'heapLimitMb',
  uptime_s: 'uptimeSeconds',
} as const
const SAFE_TEXT = /^[\w.+-]{1,64}$/

/** Keeps only the allowlisted Crashpad annotations, in a fixed shape. */
export function crashReportMetadata(fields: Record<string, unknown>): CrashReportMetadata {
  const metadata: CrashReportMetadata = {}

  for (const [field, key] of Object.entries(TEXT_FIELDS)) {
    const value = fields[field]

    if (typeof value === 'string' && SAFE_TEXT.test(value)) metadata[key] = value
  }
  for (const [field, key] of Object.entries(NUMBER_FIELDS)) {
    const value = Number(fields[field])

    if (typeof fields[field] === 'string' && Number.isSafeInteger(value) && value >= 0) {
      metadata[key] = value
    }
  }

  return metadata
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function consumeCrashReportRateLimit(input: {
  device: string
  ip: string
}): Promise<DownloadHandoffRateLimitResult> {
  return consumePairQuota(
    {
      key: `crash-report:device:${hash(input.device)}`,
      limit: DEVICE_LIMIT,
      windowSeconds: WINDOW_SECONDS,
    },
    { key: `crash-report:ip:${hash(input.ip)}`, limit: IP_LIMIT, windowSeconds: WINDOW_SECONDS },
  )
}

export async function saveCrashReport(
  dump: Uint8Array,
  metadata: CrashReportMetadata,
): Promise<{ id: string }> {
  const { bucket, region, accessKeyId, secretAccessKey, endpoint } = config.fileTransfer.s3

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new AppError(503, 'crash_reports_unconfigured', 'Crash report storage is not configured')
  }
  const client = makeS3Client({
    region,
    accessKeyId,
    secretAccessKey,
    endpoint,
    requestChecksumCalculation: undefined,
  })
  const id = randomUUID()
  const receivedAt = new Date().toISOString()
  const prefix = `crash-reports/${receivedAt.slice(0, 10)}/${id}`

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}.dmp`,
      Body: dump,
      ContentType: 'application/octet-stream',
    }),
  )
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}.json`,
      Body: JSON.stringify({ id, receivedAt, sizeBytes: dump.byteLength, ...metadata }),
      ContentType: 'application/json',
    }),
  )
  capture('desktop_native_crash', {
    properties: { report_id: id, size_bytes: dump.byteLength, ...metadata },
  })

  return { id }
}
