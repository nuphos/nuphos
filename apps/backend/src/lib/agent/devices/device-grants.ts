import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import { buildDeviceAccessAuditEntry, recordDeviceAccessChange } from './access-audit'
import { migrateDeviceAccessGrants } from './device-grants-migration'
import { agentDevices } from './store'

import type { DeviceAccessChanger } from './access-audit'
import type { AgentDevice, DeviceGrant } from './store'

/**
 * Who besides a computer's owner may use or manage it, one grant per team.
 * A cloud computer counts only in its own team; a person's computer in every
 * team its owner grants in. See box-access for what each level allows.
 */

/** Indexes grants, then moves access stored the old way into them, before any request reads it. */
export async function setupDeviceGrantIndexes(): Promise<void> {
  await agentDevices().createIndex(
    { 'access.teamId': 1 },
    { partialFilterExpression: { 'access.0': { $exists: true } }, name: 'agent_device_access' },
  )
  const migrated = await migrateDeviceAccessGrants()

  if (migrated > 0)
    logEvent('info', 'backend.migration.device_access_grants', { devices: migrated })
}

/** This team's grant on the computer, if any. */
export function teamGrant(device: AgentDevice, teamId: string): DeviceGrant | undefined {
  return device.access?.find((grant) => grant.teamId === teamId)
}

/** Who may use the computer in this team, besides its owner and managers. */
export function teamUse(
  device: AgentDevice,
  teamId: string,
): { everyone: boolean; userIds: string[] } {
  const grant = teamGrant(device, teamId)

  return { everyone: grant?.everyone ?? false, userIds: grant?.userIds ?? [] }
}

/**
 * Replaces who may use the computer in this team, and its managers when given; otherwise it
 * keeps them. One update, so two saves at once never leave the team with two grants or none.
 * Every change is audited with who made it and the grant it replaced.
 */
export async function setTeamUse(
  userId: string,
  deviceId: string,
  teamId: string,
  use: { everyone: boolean; userIds: string[] },
  by: DeviceAccessChanger,
  /** The new managers, and when they follow from the ones read, those, which must still hold. */
  managers?: { ids: string[]; read?: string[] },
): Promise<boolean> {
  const { ids: managerIds, read: readManagers } = managers ?? {}
  const others = {
    $filter: { input: { $ifNull: ['$access', []] }, cond: { $ne: ['$$this.teamId', teamId] } },
  }
  const current = {
    $arrayElemAt: [
      {
        $filter: { input: { $ifNull: ['$access', []] }, cond: { $eq: ['$$this.teamId', teamId] } },
      },
      0,
    ],
  }
  const filter = { userId, deviceId, ...(readManagers ? sameManagers(teamId, readManagers) : {}) }
  const before = await agentDevices().findOneAndUpdate(
    filter,
    [
      {
        $set: {
          access: {
            $concatArrays: [
              others,
              [
                {
                  teamId: { $literal: teamId },
                  everyone: { $literal: use.everyone },
                  userIds: { $literal: use.userIds },
                  managerIds: managerIds
                    ? { $literal: managerIds }
                    : {
                        $let: { vars: { current }, in: { $ifNull: ['$$current.managerIds', []] } },
                      },
                },
              ],
            ],
          },
          ...legacyUse(teamId, use),
          updatedAt: '$$NOW',
        },
      },
    ],
    { returnDocument: 'before' },
  )

  // Someone changed the managers since the read: writing would put the old ones back.
  if (!before && readManagers && (await agentDevices().findOne({ userId, deviceId })))
    throw new AppError(
      409,
      'access_changed',
      'Access changed while you were editing; reopen Manage access.',
    )
  if (!before) return false
  const kept = teamGrant(before, teamId)?.managerIds ?? []

  await recordDeviceAccessChange(
    buildDeviceAccessAuditEntry(before, teamId, { ...use, managerIds: managerIds ?? kept }, by),
  )

  return true
}

/** Matches only while this team's managers are still exactly these; none also means no grant yet. */
function sameManagers(teamId: string, managerIds: string[]) {
  const same = { access: { $elemMatch: { teamId, managerIds } } }

  return managerIds.length
    ? same
    : { $or: [same, { access: { $not: { $elemMatch: { teamId } } } }] }
}

/**
 * The same list in the fields an older release reads, so a rollback still sees it:
 * a cloud computer's own list, which named its creator, or a person's computer's share.
 */
function legacyUse(teamId: string, use: { everyone: boolean; userIds: string[] }) {
  const isBox = { $eq: [{ $type: '$box' }, 'object'] }
  const owner = { $ifNull: ['$box.createdBy', '$userId'] }
  const otherShares = {
    $filter: { input: { $ifNull: ['$shares', []] }, cond: { $ne: ['$$this.teamId', teamId] } },
  }
  const share = { teamId, level: 'full', ...use }

  return {
    box: {
      $cond: [
        isBox,
        {
          $mergeObjects: [
            '$box',
            {
              access: {
                everyone: { $literal: use.everyone },
                userIds: { $concatArrays: [[owner], { $literal: use.userIds }] },
              },
            },
          ],
        },
        '$$REMOVE',
      ],
    },
    shares: {
      $cond: [
        isBox,
        '$shares',
        {
          $concatArrays: [
            otherShares,
            use.everyone || use.userIds.length > 0 ? [{ $literal: share }] : [],
          ],
        },
      ],
    },
  }
}

/** Lets these people use the computer in this team too, keeping everyone it already lets. */
export async function addTeamUse(
  device: AgentDevice,
  teamId: string,
  userIds: string[],
  by: DeviceAccessChanger,
) {
  const use = teamUse(device, teamId)

  if (use.everyone) return true

  return setTeamUse(
    device.userId,
    device.deviceId,
    teamId,
    {
      everyone: false,
      userIds: [...new Set([...use.userIds, ...userIds])],
    },
    by,
  )
}

/** Someone who left the team keeps no use or management of any computer in it. */
export async function dropFromTeamGrants(teamId: string, userId: string): Promise<void> {
  await agentDevices().updateMany(
    { access: { $elemMatch: { teamId, $or: [{ userIds: userId }, { managerIds: userId }] } } },
    { $pull: { 'access.$[grant].userIds': userId, 'access.$[grant].managerIds': userId } },
    { arrayFilters: [{ 'grant.teamId': teamId }] },
  )
}

/** An owner who left the team: their own computers stop being granted in it. */
export async function dropOwnerTeamGrants(teamId: string, ownerId: string): Promise<void> {
  await agentDevices().updateMany(
    { userId: ownerId, box: { $exists: false }, 'access.teamId': teamId },
    { $pull: { access: { teamId } } },
  )
}

/** The team's cloud computers someone owned pass to the team's owner when they leave. */
export async function transferTeamComputers(
  teamId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  await agentDevices().updateMany(
    { 'box.teamId': teamId, 'box.createdBy': fromId, 'box.provider': { $ne: 'k8s' } },
    { $set: { 'box.createdBy': toId, updatedAt: new Date() } },
  )
}
