import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import { DEVICE_EXEC_AUDIT_RETENTION_DAYS } from './audit'

import type { AgentDevice, DeviceGrant } from './store'
import type { Collection } from 'mongodb'

/** The flow that changed a computer's access. */
export type DeviceAccessChangeVia =
  'share' | 'box_access' | 'conversation_invite' | 'conversation_move'

/** Who changes a computer's access, and through what. */
export type DeviceAccessChanger = { actorUserId: string; via: DeviceAccessChangeVia }

type TeamAccess = Omit<DeviceGrant, 'teamId'>

/** One change to who may use or manage a computer in a team, kept as long as device exec audits. */
export type DeviceAccessAuditEntry = {
  ownerUserId: string
  deviceId: string
  teamId: string
  actorUserId: string
  /** What let the actor make the change, read from the computer just before it; null means neither. */
  actorAuthority: 'owner' | 'manage' | null
  via: DeviceAccessChangeVia
  previous: TeamAccess | null
  next: TeamAccess
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

/** The audit row for a change, from the computer as it was just before it. */
export function buildDeviceAccessAuditEntry(
  before: AgentDevice,
  teamId: string,
  next: TeamAccess,
  by: DeviceAccessChanger,
  changedAt: Date = new Date(),
): DeviceAccessAuditEntry {
  const previous = grantAccess(before.access?.find((grant) => grant.teamId === teamId))
  // As deviceOwner and deviceAccess in box-access, which imports this module's caller.
  const owner = (before.box?.createdBy ?? before.userId) === by.actorUserId
  const manager = previous?.managerIds.includes(by.actorUserId) ?? false

  return {
    ownerUserId: before.userId,
    deviceId: before.deviceId,
    teamId,
    actorUserId: by.actorUserId,
    actorAuthority: owner ? 'owner' : manager ? 'manage' : null,
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
