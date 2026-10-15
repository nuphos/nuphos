import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { tunnelBus } from './local-runtime/bus'
import { holderChannel } from './local-runtime/protocol'
import { getAgentDevice, listAgentDevicesForUser, listTeamBoxes } from './store'

import type { HolderMessage } from './local-runtime/protocol'

import type { AgentDevice } from './store'
import type { NuphosTeamRole } from '@/lib/identity/types'

export type DeviceAccessLevel = 'use' | 'manage'
export type DeviceAccessDeps = {
  getDevice: typeof getAgentDevice
  listDevices: typeof listAgentDevicesForUser
  listBoxes: typeof listTeamBoxes
  role: (actorId: string, teamId: string) => Promise<NuphosTeamRole | null>
}
export const deviceAccessDeps: DeviceAccessDeps = {
  getDevice: (owner, id) => getAgentDevice(owner, id),
  listDevices: (owner) => listAgentDevicesForUser(owner),
  listBoxes: (team) => listTeamBoxes(team),
  role: async (actorId, teamId) => (await getTeamMembership(actorId, teamId))?.role ?? null,
}

/** Legacy rows remain creator-only for use; createdBy never confers management. */
export function deviceAccess(
  device: AgentDevice,
  actorId: string,
  teamId: string | undefined,
  role: NuphosTeamRole | null,
): DeviceAccessLevel | null {
  if (!device.box) return device.userId === actorId ? 'manage' : null
  if (!teamId || device.box.teamId !== teamId || !role) return null
  if (role === 'ADMINISTRATOR') return 'manage'
  const access = device.box.access ?? {
    everyone: false,
    userIds: [device.box.createdBy ?? device.userId],
  }

  return access.everyone || access.userIds.includes(actorId) ? 'use' : null
}

export async function listAccessibleDevices(
  actorId: string,
  teamId: string | undefined,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<AgentDevice[]> {
  const own = (await deps.listDevices(actorId)).filter((device) => !device.box)

  if (!teamId) return own
  const role = await deps.role(actorId, teamId)

  if (!role) return own
  const boxes = await deps.listBoxes(teamId)

  return [...own, ...boxes.filter((device) => deviceAccess(device, actorId, teamId, role))]
}

/** Returns the persistent owner for transport; the caller must retain actorId for audit. */
export async function requireDeviceAccess(
  actorId: string,
  teamId: string | undefined,
  deviceId: string,
  level: DeviceAccessLevel,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<AgentDevice> {
  const own = await deps.getDevice(actorId, deviceId)
  const role = teamId ? await deps.role(actorId, teamId) : null
  // Query the requested team, never a global deviceId lookup or the owner's other teams.
  const candidates =
    own && !own.box
      ? [own]
      : teamId
        ? (await deps.listBoxes(teamId)).filter((box) => box.deviceId === deviceId)
        : []
  const device = candidates.length === 1 ? candidates[0] : undefined
  const access = device && deviceAccess(device, actorId, teamId, role)

  if (!device || !access || (level === 'manage' && access !== 'manage'))
    throw new AppError(404, 'device_not_found', 'Device is not available')

  return device
}

/**
 * Closes what these people have open on these Boxes (terminal, CUA, chat streams)
 * and nothing else: the host's tunnel and other viewers stay. A reconnect is
 * refused by the access check. Best effort: a missed message leaves a stream only
 * until its next reconnect.
 */
export async function revokeBoxStreams(devices: AgentDevice[], actorIds: string[]): Promise<void> {
  const bus = tunnelBus()

  await Promise.all(
    devices.flatMap((device) =>
      actorIds.map((actorId) =>
        bus
          .publish(
            holderChannel(device.userId, device.deviceId),
            JSON.stringify({ t: 'revoke-actor', actorId } satisfies HolderMessage),
          )
          .catch(() => {}),
      ),
    ),
  )
}

/** For a person who left the team, was removed, or lost a role: every Box of that team. */
export async function revokeTeamBoxStreams(teamId: string, actorId: string): Promise<void> {
  await revokeBoxStreams(await listTeamBoxes(teamId).catch(() => []), [actorId])
}
