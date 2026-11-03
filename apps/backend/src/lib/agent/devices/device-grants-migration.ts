import { getTeamMembers } from '@/lib/identity'

import { agentDevices } from './store'

import type { AgentDevice, DeviceGrant } from './store'

/** The shapes access was stored in before grants: a share per team, or a Box's own list. */
type LegacyDevice = AgentDevice & {
  shares?: { teamId: string; level: string; everyone: boolean; userIds: string[] }[]
  box?: AgentDevice['box'] & { access?: { everyone: boolean; userIds: string[] } }
}

export type GrantMigrationDeps = {
  /** The team's administrators, who managed its cloud computers before grants. */
  adminIds: (teamId: string) => Promise<string[]>
}
const defaultDeps: GrantMigrationDeps = {
  adminIds: async (teamId) =>
    (await getTeamMembers(teamId))
      .filter((member) => member.role === 'ADMINISTRATOR')
      .map((member) => member.id),
}

/** The grants a device stored the old way gets: what its owner allowed then, nothing more. */
export async function legacyGrants(
  device: LegacyDevice,
  deps: GrantMigrationDeps = defaultDeps,
): Promise<DeviceGrant[]> {
  if (!device.box)
    return (device.shares ?? []).map((share) => ({
      teamId: share.teamId,
      everyone: share.everyone,
      userIds: share.userIds,
      managerIds: [],
    }))
  const owner = device.box.createdBy ?? device.userId
  const access = device.box.access ?? { everyone: false, userIds: [] }
  const others = (ids: string[]) => [...new Set(ids)].filter((id) => id !== owner)

  return [
    {
      teamId: device.box.teamId,
      everyone: access.everyone,
      userIds: others(access.userIds),
      // A managed runtime's pod is reached through its runtime, never managed as a computer.
      managerIds:
        device.box.provider === 'k8s' ? [] : others(await deps.adminIds(device.box.teamId)),
    },
  ]
}

/**
 * Moves people's computer shares and cloud computers' access lists into grants:
 * a share at any level becomes use, a team's administrators become managers of
 * its cloud computers, and their creator stays their owner. Idempotent: every
 * pass removes the old fields it migrates.
 */
export async function migrateDeviceAccessGrants(
  deps: GrantMigrationDeps = defaultDeps,
): Promise<number> {
  const legacy = await agentDevices()
    .find<LegacyDevice>({
      $or: [
        { shares: { $exists: true } },
        { 'box.access': { $exists: true } },
        { box: { $exists: true }, access: { $exists: false } },
      ],
    })
    .toArray()

  for (const device of legacy)
    await agentDevices().updateOne(
      { userId: device.userId, deviceId: device.deviceId },
      {
        $set: {
          access: await legacyGrants(device, deps),
          ...(device.box && !device.box.createdBy ? { 'box.createdBy': device.userId } : {}),
        },
        $unset: { shares: '', 'box.access': '' },
      },
    )

  return legacy.length
}
