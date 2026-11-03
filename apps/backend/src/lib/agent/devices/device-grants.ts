import { logEvent } from '@/lib/observability'

import { migrateDeviceAccessGrants } from './device-grants-migration'
import { agentDevices } from './store'

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
 * Replaces who may use the computer in this team, keeping its managers. One update,
 * so two saves at once never leave the team with two grants or none.
 */
export async function setTeamUse(
  userId: string,
  deviceId: string,
  teamId: string,
  use: { everyone: boolean; userIds: string[] },
): Promise<boolean> {
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
  const result = await agentDevices().updateOne({ userId, deviceId }, [
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
                managerIds: {
                  $let: { vars: { current }, in: { $ifNull: ['$$current.managerIds', []] } },
                },
              },
            ],
          ],
        },
        updatedAt: '$$NOW',
      },
    },
  ])

  return result.matchedCount === 1
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
