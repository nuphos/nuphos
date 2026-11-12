import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db/shared'
import { db } from '@/lib/db'
import { logError } from '@/lib/observability'
import { redactSecrets } from '@/lib/secrets/scan'

import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { Collection, Filter } from 'mongodb'

export const DEVICE_EXEC_AUDIT_RETENTION_DAYS = 90
const DEVICE_EXEC_AUDIT_COMMAND_MAX_CHARS = 4000

export type DeviceExecOutcome =
  'ok' | 'timeout' | 'device_offline' | 'rejected' | 'error' | 'unknown'

export type DeviceExecAuditEntry = {
  _id?: ObjectId
  operationId?: string
  ownerUserId: string
  deviceId: string
  actorUserId: string
  conversationOwnerUserId: string
  origin: AgentSessionOrigin
  teamId: string
  sessionId: string
  command: string
  commandRedacted: boolean
  requestedAt: Date
  dispatchedAt?: Date
  finishedAt: Date | null
  durationMs: number | null
  outcome: DeviceExecOutcome
  exitCode?: number
  reason?: string
}

export type DeviceExecAuditInput = Omit<
  DeviceExecAuditEntry,
  '_id' | 'commandRedacted' | 'durationMs'
>

const deviceExecAudit = (): Collection<DeviceExecAuditEntry> =>
  db().collection<DeviceExecAuditEntry>('agent_device_exec_audit')

export async function setupDeviceExecAuditIndexes(): Promise<void> {
  const collection = deviceExecAudit()

  await collection.createIndex(
    { ownerUserId: 1, deviceId: 1, requestedAt: -1, _id: -1 },
    { name: 'device_exec_audit_owner_device_recent' },
  )
  await collection.createIndex(
    { operationId: 1 },
    { unique: true, partialFilterExpression: { operationId: { $type: 'string' } } },
  )
  await collection.createIndex(
    { requestedAt: 1 },
    {
      name: 'device_exec_audit_ttl',
      expireAfterSeconds: DEVICE_EXEC_AUDIT_RETENTION_DAYS * 24 * 60 * 60,
    },
  )
}

/**
 * The same command is already stored verbatim in the conversation transcript;
 * this scrub is a best-effort courtesy for obvious token shapes, not a
 * security boundary.
 */
export async function buildDeviceExecAuditEntry(
  input: DeviceExecAuditInput,
): Promise<DeviceExecAuditEntry> {
  const { redacted, redactedCount } = await redactSecrets(input.command)
  const commandRedacted = redactedCount > 0
  const command =
    redacted.length > DEVICE_EXEC_AUDIT_COMMAND_MAX_CHARS
      ? `${redacted.slice(0, DEVICE_EXEC_AUDIT_COMMAND_MAX_CHARS)}…`
      : redacted

  return {
    ...input,
    command,
    commandRedacted,
    durationMs: input.finishedAt
      ? Math.max(0, input.finishedAt.getTime() - input.requestedAt.getTime())
      : null,
  }
}

/** Best effort: an audit write failure must never fail the command it describes. */
export async function recordDeviceExecAudit(input: DeviceExecAuditInput): Promise<void> {
  try {
    const entry = await buildDeviceExecAuditEntry(input)

    if (input.operationId) {
      await deviceExecAudit().updateOne(
        { operationId: input.operationId },
        { $set: entry },
        { upsert: true },
      )
    } else await deviceExecAudit().insertOne(entry)
  } catch (err) {
    logError('agent.device_exec_audit.write_failed', err, {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
    })
  }
}

export type DeviceExecAuditPage = {
  entries: DeviceExecAuditEntry[]
  nextCursor: string | null
}

type AuditCursor = { requestedAt: Date; id: ObjectId }

export function encodeAuditCursor(entry: Pick<DeviceExecAuditEntry, 'requestedAt' | '_id'>) {
  return entry._id ? `${entry.requestedAt.toISOString()}_${entry._id.toHexString()}` : null
}

export function decodeAuditCursor(cursor: string): AuditCursor | null {
  const [iso, id] = cursor.split('_')
  const requestedAt = new Date(iso ?? '')

  if (!id || !ObjectId.isValid(id) || Number.isNaN(requestedAt.getTime())) return null

  return { requestedAt, id: new ObjectId(id) }
}

export function auditCursorFilter(cursor: AuditCursor): Filter<DeviceExecAuditEntry> {
  return {
    $or: [
      { requestedAt: { $lt: cursor.requestedAt } },
      { requestedAt: cursor.requestedAt, _id: { $lt: cursor.id } },
    ],
  }
}

export async function listDeviceExecAudit(
  ownerUserId: string,
  deviceId: string,
  options: { limit: number; cursor?: string; includeUnfinished?: boolean },
): Promise<DeviceExecAuditPage> {
  const cursor = options.cursor ? decodeAuditCursor(options.cursor) : null
  const filter: Filter<DeviceExecAuditEntry> = {
    ownerUserId,
    deviceId,
    ...(!options.includeUnfinished ? { outcome: { $ne: 'unknown' as const } } : {}),
    ...(cursor ? auditCursorFilter(cursor) : {}),
  }
  const docs = await deviceExecAudit()
    .find(filter)
    .sort({ requestedAt: -1, _id: -1 })
    .limit(options.limit + 1)
    .toArray()
  const entries = docs.slice(0, options.limit)
  const last = entries.at(-1)

  return {
    entries,
    nextCursor: docs.length > options.limit && last ? encodeAuditCursor(last) : null,
  }
}

export async function conversationTitlesFor(sessionIds: string[]): Promise<Map<string, string>> {
  if (sessionIds.length === 0) return new Map()
  const docs = await agentConversations()
    .find({ sessionId: { $in: sessionIds } }, { projection: { sessionId: 1, title: 1 } })
    .toArray()

  return new Map(docs.map((doc) => [doc.sessionId, doc.title]))
}
