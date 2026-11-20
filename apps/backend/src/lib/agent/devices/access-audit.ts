import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import { DEVICE_EXEC_AUDIT_RETENTION_DAYS, decodeAuditCursor, encodeAuditCursor } from './audit'

import type { AgentDevice, DeviceGrant } from './store'
import type { Collection, Filter, ObjectId } from 'mongodb'

/** The flow that changed a computer's access. */
export type DeviceAccessChangeVia =
  | 'share'
  | 'box_access'
  | 'conversation_invite'
  | 'conversation_move'
  | 'team_leave'
  | 'team_removal'

/** Changes that follow from someone leaving or being removed from the team, not a grant edit. */
const MEMBERSHIP_VIAS = new Set<DeviceAccessChangeVia>(['team_leave', 'team_removal'])

/** Who changes a computer's access, and through what. */
export type DeviceAccessChanger = { actorUserId: string; via: DeviceAccessChangeVia }

type TeamAccess = Omit<DeviceGrant, 'teamId'>

/** One change to who may use or manage a computer in a team, kept as long as device exec audits. */
export type DeviceAccessAuditEntry = {
  _id?: ObjectId
  ownerUserId: string
  deviceId: string
  teamId: string
  actorUserId: string
  /**
   * What let the actor make the change: owner or manager of the computer just before it, or a
   * team membership change; null means none of these.
   */
  actorAuthority: 'owner' | 'manage' | 'team_membership' | null
  via: DeviceAccessChangeVia
  previous: TeamAccess | null
  /** Null when the computer stops being granted in the team. */
  next: TeamAccess | null
  /** Set when the change hands a cloud computer to a new owner; its grants stay as they were. */
  owner?: { from: string; to: string }
  changedAt: Date
}

const deviceAccessAudit = (): Collection<DeviceAccessAuditEntry> =>
  db().collection<DeviceAccessAuditEntry>('agent_device_access_audit')

export async function setupDeviceAccessAuditIndexes(): Promise<void> {
  const collection = deviceAccessAudit()

  await collection.createIndex(
    { ownerUserId: 1, deviceId: 1, changedAt: -1 },
    { name: 'device_access_audit_owner_device_recent' },
  )
  await collection.createIndex(
    { changedAt: 1 },
    {
      name: 'device_access_audit_ttl',
      expireAfterSeconds: DEVICE_EXEC_AUDIT_RETENTION_DAYS * 24 * 60 * 60,
    },
  )
}

function grantAccess(grant: DeviceGrant | undefined): TeamAccess | null {
  return grant
    ? { everyone: grant.everyone, userIds: grant.userIds, managerIds: grant.managerIds }
    : null
}

function authorityOf(
  before: AgentDevice,
  previous: TeamAccess | null,
  by: DeviceAccessChanger,
): DeviceAccessAuditEntry['actorAuthority'] {
  if (MEMBERSHIP_VIAS.has(by.via)) return 'team_membership'
  // As deviceOwner in box-access, which imports this module's caller; a test keeps them in step.
  if ((before.box?.createdBy ?? before.userId) === by.actorUserId) return 'owner'

  return previous?.managerIds.includes(by.actorUserId) ? 'manage' : null
}

/** The audit row for a change, from the computer as it was just before it. */
export function buildDeviceAccessAuditEntry(
  before: AgentDevice,
  teamId: string,
  next: TeamAccess | null,
  by: DeviceAccessChanger,
  changedAt: Date = new Date(),
): DeviceAccessAuditEntry {
  const previous = grantAccess(before.access?.find((grant) => grant.teamId === teamId))

  return {
    ownerUserId: before.userId,
    deviceId: before.deviceId,
    teamId,
    actorUserId: by.actorUserId,
    actorAuthority: authorityOf(before, previous, by),
    via: by.via,
    previous,
    next,
    changedAt,
  }
}

/** Best effort, as device exec audits: a failed write is logged, never undoes the change. */
export async function recordDeviceAccessChange(entry: DeviceAccessAuditEntry): Promise<void> {
  try {
    await deviceAccessAudit().insertOne(entry)
  } catch (err) {
    logError('agent.device_access_audit.write_failed', err, {
      deviceId: entry.deviceId,
      teamId: entry.teamId,
      via: entry.via,
    })
  }
}

export type DeviceAccessAuditPage = {
  entries: DeviceAccessAuditEntry[]
  nextCursor: string | null
}

/**
 * One computer's access changes in one team, newest first. The caller has checked who may read
 * them; the filter keeps other computers and other teams out whatever it passes.
 */
export async function listDeviceAccessAudit(
  scope: { ownerUserId: string; deviceId: string; teamId: string },
  options: { limit: number; cursor?: string; since?: Date; until?: Date },
): Promise<DeviceAccessAuditPage> {
  const cursor = options.cursor ? decodeAuditCursor(options.cursor) : null
  const changedAt = {
    ...(options.since ? { $gte: options.since } : {}),
    ...(options.until ? { $lt: options.until } : {}),
  }
  const filter: Filter<DeviceAccessAuditEntry> = {
    ...scope,
    ...(options.since || options.until ? { changedAt } : {}),
    ...(cursor
      ? {
          $or: [
            { changedAt: { $lt: cursor.requestedAt } },
            { changedAt: cursor.requestedAt, _id: { $lt: cursor.id } },
          ],
        }
      : {}),
  }
  const docs = await deviceAccessAudit()
    .find(filter)
    .sort({ changedAt: -1, _id: -1 })
    .limit(options.limit + 1)
    .toArray()
  const entries = docs.slice(0, options.limit)
  const last = entries.at(-1)

  return {
    entries,
    nextCursor:
      docs.length > options.limit && last
        ? encodeAuditCursor({ requestedAt: last.changedAt, _id: last._id })
        : null,
  }
}
