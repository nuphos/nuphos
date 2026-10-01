import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db/shared'
import { db } from '@/lib/db'
import { redactSecrets } from '@/lib/journal/redact'
import { logError } from '@/lib/observability'

import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { Collection, Filter } from 'mongodb'

export const DEVICE_EXEC_AUDIT_RETENTION_DAYS = 90
const DEVICE_EXEC_AUDIT_COMMAND_MAX_CHARS = 4000

export type DeviceExecOutcome = 'ok' | 'timeout' | 'device_offline' | 'rejected' | 'error'

export type DeviceExecAuditEntry = {
  _id?: ObjectId
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
  finishedAt: Date
  durationMs: number
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
export function buildDeviceExecAuditEntry(input: DeviceExecAuditInput): DeviceExecAuditEntry {
  const { redacted, redactedCount } = redactSecrets(input.command)
  const commandRedacted = redactedCount > 0
  const command =
    redacted.length > DEVICE_EXEC_AUDIT_COMMAND_MAX_CHARS
      ? `${redacted.slice(0, DEVICE_EXEC_AUDIT_COMMAND_MAX_CHARS)}…`
      : redacted

  return {
    ...input,
    command,
    commandRedacted,
    durationMs: Math.max(0, input.finishedAt.getTime() - input.requestedAt.getTime()),
  }
}

/** Best effort: an audit write failure must never fail the command it describes. */
export async function recordDeviceExecAudit(input: DeviceExecAuditInput): Promise<void> {
  try {
    await deviceExecAudit().insertOne(buildDeviceExecAuditEntry(input))
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
  options: { limit: number; cursor?: string },
): Promise<DeviceExecAuditPage> {
  const cursor = options.cursor ? decodeAuditCursor(options.cursor) : null
  const filter: Filter<DeviceExecAuditEntry> = {
    ownerUserId,
    deviceId,
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
