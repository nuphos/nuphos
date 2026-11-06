import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { connectedComputerCount } from '@/lib/agent/devices/local-runtime/holder'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { isEmailConfigured } from '@/lib/email'
import { logEvent } from '@/lib/observability'

import { version } from '../../../package.json'

import { setTelemetryRecording, takeTelemetryWindow } from './window'

import type { TelemetryWindow } from './window'

export const REPORT_INTERVAL_MS = 5 * 60_000
const RETRY_DELAYS_MS = [5_000, 30_000]
const STATE_ID = 'instance'
const replicaId = randomUUID()

/** Every field a health report may carry. report.test.ts holds the payload to it. */
export const REPORT_FIELDS = {
  schemaVersion: 'number',
  instanceId: 'string',
  // 0 when Mongo could not be read, so instanceId is a stand-in for this process.
  instanceIdPersisted: 'number',
  replicaId: 'string',
  version: 'string',
  uptimeSeconds: 'number',
  windowSeconds: 'number',
  activeUsers: 'number',
  dependencies: {
    mongoOk: 'number',
    mongoPingMs: 'number',
    s3Configured: 'number',
    emailConfigured: 'number',
    kmsConfigured: 'number',
    connectedComputers: 'number',
  },
  storage: {
    dbDataBytes: 'number',
    dbStorageBytes: 'number',
    dbDiskUsedBytes: 'number',
    dbDiskTotalBytes: 'number',
  },
  api: {
    requests: 'number',
    errors4xx: 'number',
    errors5xx: 'number',
    latencyP50Ms: 'number',
    latencyP95Ms: 'number',
    latencyP99Ms: 'number',
  },
  // Keys are logEvent() names from events.json; values are counts.
  events: 'counts',
} as const

export type HealthReport = {
  schemaVersion: 1
  instanceId: string
  instanceIdPersisted: number
  replicaId: string
  version: string
  uptimeSeconds: number
  windowSeconds: number
  activeUsers: number
  dependencies: Record<keyof (typeof REPORT_FIELDS)['dependencies'], number>
  storage: Record<keyof (typeof REPORT_FIELDS)['storage'], number>
  api: TelemetryWindow['api']
  events: Record<string, number>
}

type TelemetryState = {
  _id: string
  instanceId: string
  disabled?: boolean
  lastReport?: string
  lastAttemptAt?: Date
  lastDelivered?: boolean
}

const stateCollection = () => db().collection<TelemetryState>('telemetry_state')

type ReportState = { instanceId: string; persisted: boolean; disabled: boolean }

const unpersistedId = randomUUID()
let knownState: ReportState | null = null

/** Reads this instance's state, giving it a random id the first time. With Mongo
 *  down it reuses the last read, or an id flagged as unpersisted, and sends anyway. */
async function loadState(): Promise<ReportState> {
  try {
    const doc = await stateCollection().findOneAndUpdate(
      { _id: STATE_ID },
      [{ $set: { instanceId: { $ifNull: ['$instanceId', randomUUID()] } } }],
      { upsert: true, returnDocument: 'after' },
    )

    if (doc) knownState = { instanceId: doc.instanceId, persisted: true, disabled: !!doc.disabled }
  } catch {
    // The report saying Mongo is down is the one that matters most.
  }

  return knownState ?? { instanceId: unpersistedId, persisted: false, disabled: false }
}

const flag = (on: unknown) => (on ? 1 : 0)

async function mongoHealth(): Promise<Pick<HealthReport, 'dependencies' | 'storage'>> {
  const dependencies = {
    mongoOk: 0,
    mongoPingMs: 0,
    s3Configured: flag(config.fileTransfer.s3.bucket),
    emailConfigured: flag(isEmailConfigured()),
    kmsConfigured: flag(config.auth.internalTokens.kmsKeyId ?? config.journal.kmsSigningKeyId),
    connectedComputers: connectedComputerCount(),
  }
  const storage = { dbDataBytes: 0, dbStorageBytes: 0, dbDiskUsedBytes: 0, dbDiskTotalBytes: 0 }

  try {
    const startedAt = Date.now()

    await db().command({ ping: 1 })
    dependencies.mongoPingMs = Date.now() - startedAt
    dependencies.mongoOk = 1
    const stats = await db().command({ dbStats: 1 })

    storage.dbDataBytes = Number(stats.dataSize) || 0
    storage.dbStorageBytes = Number(stats.storageSize) || 0
    storage.dbDiskUsedBytes = Number(stats.fsUsedSize) || 0
    storage.dbDiskTotalBytes = Number(stats.fsTotalSize) || 0
  } catch {
    // A failing database is exactly what the report is for; mongoOk stays 0.
  }

  return { dependencies, storage }
}

export async function buildHealthReport(
  { instanceId, persisted }: Pick<ReportState, 'instanceId' | 'persisted'>,
  windowSeconds: number,
  window: TelemetryWindow,
): Promise<HealthReport> {
  return {
    schemaVersion: 1,
    instanceId,
    instanceIdPersisted: flag(persisted),
    replicaId,
    version,
    uptimeSeconds: Math.round(process.uptime()),
    windowSeconds,
    activeUsers: window.activeUsers,
    ...(await mongoHealth()),
    api: window.api,
    events: window.events,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** POSTs with bounded retries; never throws. Returns whether it was delivered. */
export async function sendHealthReport(body: string, wait = sleep): Promise<boolean> {
  let status: number | undefined
  let attempts = 0

  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay) await wait(delay)
    attempts++
    try {
      const res = await fetch(config.telemetry.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.telemetry.key ?? ''}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })

      if (res.ok) return true
      status = res.status
      // A revoked or rejected key will not start working on a retry.
      if (status < 500 && status !== 429) break
    } catch {
      status = undefined
    }
  }
  logEvent('warn', 'backend.telemetry.send_failed', { status, attempts })

  return false
}

let windowStartedAt = Date.now()

export async function reportHealth(now = Date.now()): Promise<void> {
  const window = takeTelemetryWindow()
  const windowSeconds = Math.round((now - windowStartedAt) / 1000)

  windowStartedAt = now
  const state = await loadState()

  if (state.disabled) return
  const body = JSON.stringify(await buildHealthReport(state, windowSeconds, window))
  const delivered = await sendHealthReport(body)

  await stateCollection()
    .updateOne(
      { _id: STATE_ID },
      { $set: { lastReport: body, lastAttemptAt: new Date(), lastDelivered: delivered } },
    )
    .catch(() => {})
}

let timer: ReturnType<typeof setInterval> | undefined
let reporting = false

/** Starts the 5-minute report loop when NUPHOS_TELEMETRY_KEY is set. The timer
 *  is unref'd and holds nothing to flush, so shutdown has nothing to stop. */
export function startHealthTelemetry(): void {
  if (!config.telemetry.key || timer) return
  setTelemetryRecording(true)
  windowStartedAt = Date.now()
  timer = setInterval(() => {
    if (reporting) return
    reporting = true
    reportHealth()
      .catch(() => {
        logEvent('warn', 'backend.telemetry.report_failed')
      })
      .finally(() => {
        reporting = false
      })
  }, REPORT_INTERVAL_MS)
  timer.unref()
  logEvent('info', 'backend.health_telemetry.ready')
}

export type TelemetryStatus = {
  configured: boolean
  enabled: boolean
  instanceId: string | null
  lastAttemptAt: string | null
  lastDelivered: boolean | null
  lastReport: HealthReport | null
}

/** What an admin sees: whether reports go out, and the exact last one sent. */
export async function telemetryStatus(): Promise<TelemetryStatus> {
  const state = await stateCollection().findOne({ _id: STATE_ID })
  const configured = Boolean(config.telemetry.key)

  return {
    configured,
    enabled: configured && !state?.disabled,
    instanceId: state?.instanceId ?? null,
    lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null,
    lastDelivered: state?.lastDelivered ?? null,
    lastReport: state?.lastReport ? (JSON.parse(state.lastReport) as HealthReport) : null,
  }
}

export async function setTelemetryEnabled(enabled: boolean): Promise<TelemetryStatus> {
  if (enabled && !config.telemetry.key) {
    throw new AppError(
      400,
      'telemetry_key_missing',
      'NUPHOS_TELEMETRY_KEY is not set; set it and restart the backend to send health reports',
    )
  }
  await stateCollection().updateOne(
    { _id: STATE_ID },
    { $set: { disabled: !enabled } },
    { upsert: true },
  )

  return telemetryStatus()
}
