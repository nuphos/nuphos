// Native crash reports from Nuphos Desktop: Electron's crashReporter (Crashpad)
// uploads a minidump as multipart/form-data. The raw dump and a small metadata
// object go to the Zeabur-owned S3 store under `crash-reports/`, so a crash can
// be symbolicated later against Electron's public symbols for that version.
// Only allowlisted, non-identifying fields are kept, and only main-process
// dumps: a dump can hold fragments of stack memory, so the ones we don't need
// are not kept at all.
import { createHash, randomUUID } from 'node:crypto'

import { PutObjectCommand } from '@aws-sdk/client-s3'

import { config } from '@/config'
import { consumePairQuota } from '@/lib/download-handoff-rate-limit'
import { AppError } from '@/lib/errors'
import { capture } from '@/lib/posthog'
import { makeS3Client } from '@/lib/storage/s3-client'

import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'

export const CRASH_REPORT_MAX_BYTES = 10 * 1024 * 1024
const DAY = 24 * 60 * 60
const HOUR = 60 * 60
// Crashpad on the client already uploads at most one report per hour.
const DEVICE_PER_DAY = 10
const DEVICE_PER_HOUR = 3
const IP_PER_DAY = 50
const GLOBAL_PER_DAY = 1000

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

/** The quota key for an address: IPv4 as is, IPv6 by its /64 network. */
export function ipQuotaKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head = '', tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left

  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')
}

// Checked before the body is read: per address, and a global daily cap.
export function consumeCrashReportIpQuota(ip: string): Promise<DownloadHandoffRateLimitResult> {
  return consumePairQuota(
    { key: `crash-report:ip:${hash(ipQuotaKey(ip))}`, limit: IP_PER_DAY, windowSeconds: DAY },
    { key: 'crash-report:global', limit: GLOBAL_PER_DAY, windowSeconds: DAY },
  )
}

export function consumeCrashReportDeviceQuota(
  device: string,
): Promise<DownloadHandoffRateLimitResult> {
  const key = `crash-report:device:${hash(device)}`

  return consumePairQuota(
    { key: `${key}:day`, limit: DEVICE_PER_DAY, windowSeconds: DAY },
    { key: `${key}:hour`, limit: DEVICE_PER_HOUR, windowSeconds: HOUR },
  )
}

/** A minidump starts with the 'MDMP' signature. */
export function isMinidump(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x44 && bytes[2] === 0x4d && bytes[3] === 0x50
}

type CrashReportObject = { key: string; body: Uint8Array | string; contentType: string }

/** The metadata object, plus the dump only when it comes from the main process. */
export function crashReportObjects(
  id: string,
  receivedAt: string,
  dump: Uint8Array,
  metadata: CrashReportMetadata,
): CrashReportObject[] {
  const prefix = `crash-reports/${receivedAt.slice(0, 10)}/${id}`
  const dumpKept = metadata.processType === 'browser'
  const record = { id, receivedAt, sizeBytes: dump.byteLength, dumpKept, ...metadata }

  return [
    ...(dumpKept
      ? [{ key: `${prefix}.dmp`, body: dump, contentType: 'application/octet-stream' }]
      : []),
    { key: `${prefix}.json`, body: JSON.stringify(record), contentType: 'application/json' },
  ]
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
  const objects = crashReportObjects(id, new Date().toISOString(), dump, metadata)

  for (const { key, body, contentType } of objects) {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    )
  }
  capture('desktop_native_crash', {
    properties: {
      report_id: id,
      size_bytes: dump.byteLength,
      dump_kept: objects.length === 2,
      ...metadata,
    },
  })

  return { id }
}
