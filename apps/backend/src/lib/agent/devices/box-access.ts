import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { teamGrant } from './device-grants'
import { tunnelBus } from './local-runtime/bus'
import { holderChannel } from './local-runtime/protocol'
import {
  findGrantedDevices,
  getAgentDevice,
  listAgentDevicesForUser,
  listDevicesGrantedInTeam,
  listTeamBoxes,
} from './store'

import type { HolderMessage } from './local-runtime/protocol'
import type { AgentDevice } from './store'
import type { NuphosTeamRole } from '@/lib/identity/types'

/**
 * What a person may do with a computer: `use` runs its agents through Nuphos; `manage` also opens
 * a shell on it, signs its agents in and out, and chooses who uses it.
 */
export type DeviceAccessLevel = 'use' | 'manage' | 'owner'

const RANK: Record<DeviceAccessLevel, number> = { use: 0, manage: 1, owner: 2 }

/** Whether `access` allows what `needed` asks for. */
export function allows(access: DeviceAccessLevel | null, needed: DeviceAccessLevel): boolean {
  return access !== null && RANK[access] >= RANK[needed]
}

/** Who owns a computer: whoever made a cloud computer, or the person whose computer it is. */
export function deviceOwner(device: AgentDevice): string {
  return device.box?.createdBy ?? device.userId
}

/** Who among these members can no longer use the computer under this team's new use list. */
export function losingUse(
  memberIds: string[],
  device: AgentDevice,
  teamId: string,
  use: { everyone: boolean; userIds: string[] },
  /** The team's managers after the change; its current ones when it leaves them as they are. */
  managers: string[] = teamGrant(device, teamId)?.managerIds ?? [],
): string[] {
  return use.everyone
    ? []
    : memberIds.filter(
        (id) => id !== deviceOwner(device) && !managers.includes(id) && !use.userIds.includes(id),
      )
}

/**
 * Who manages the computer in this team after a share request. Only its owner names managers,
 * from the team's other members, and a manager may repeat them but not change them. A request
 * that names none, from a release that knows only the use list, keeps the managers it still
 * lets use the computer when it comes from the owner, and all of them from a manager. `read` is
 * set when the result follows from the managers as read, so the write can check they still are.
 */
export function chosenManagers(
  device: AgentDevice,
  /** Who asks, in which team. */
  { userId, teamId }: { userId: string; teamId: string },
  memberIds: string[],
  { managerIds: requested }: { managerIds?: string[] },
  use: { everyone: boolean; userIds: string[] },
): { ids: string[]; read?: string[] } {
  const current = teamGrant(device, teamId)?.managerIds ?? []
  const owner = deviceOwner(device)

  if (requested === undefined) {
    const kept =
      userId !== owner || use.everyone ? current : current.filter((id) => use.userIds.includes(id))

    return { ids: kept, read: current }
  }
  const asked = [...new Set(requested.filter((id) => id !== owner))]
  const same = asked.length === current.length && asked.every((id) => current.includes(id))

  if (userId !== owner && !same)
    throw new AppError(403, 'owner_only', 'Only the owner of this computer chooses who manages it.')
  const managers = asked.filter((id) => memberIds.includes(id))

  return userId === owner ? { ids: managers } : { ids: managers, read: current }
}

/**
 * Managing a computer includes using it, so its managers stay in the use list too: a release
 * that knows only that list still lets them use it.
 */
export function withManagers(
  use: { everyone: boolean; userIds: string[] },
  managers: string[],
): { everyone: boolean; userIds: string[] } {
  return { everyone: use.everyone, userIds: [...new Set([...use.userIds, ...managers])] }
}

/** The requested access, keeping only the team's current members, each once. */
export function memberAccess(
  members: { id: string }[],
  next: { everyone: boolean; userIds: string[] },
): { everyone: boolean; userIds: string[] } {
  const memberIds = new Set(members.map((member) => member.id))

  return {
    everyone: next.everyone,
    userIds: [...new Set(next.userIds.filter((id) => memberIds.has(id)))],
  }
}
export type DeviceAccessDeps = {
  getDevice: typeof getAgentDevice
  listDevices: typeof listAgentDevicesForUser
  listBoxes: typeof listTeamBoxes
  listGranted: typeof listDevicesGrantedInTeam
  findGranted: typeof findGrantedDevices
  role: (actorId: string, teamId: string) => Promise<NuphosTeamRole | null>
}
export const deviceAccessDeps: DeviceAccessDeps = {
  getDevice: (owner, id) => getAgentDevice(owner, id),
  listDevices: (owner) => listAgentDevicesForUser(owner),
  listBoxes: (team) => listTeamBoxes(team),
  listGranted: (team) => listDevicesGrantedInTeam(team),
  findGranted: (team, id) => findGrantedDevices(team, id),
  role: async (actorId, teamId) => (await getTeamMembership(actorId, teamId))?.role ?? null,
}

/**
 * The owner has every right; in the team asked about, a grant's managers manage and the
 * rest it names use. A cloud computer counts only in its own team. Team roles confer nothing.
 */
export function deviceAccess(
  device: AgentDevice,
  actorId: string,
  teamId: string | undefined,
): DeviceAccessLevel | null {
  if (device.box && device.box.teamId !== teamId) return null
  if (deviceOwner(device) === actorId) return 'owner'
  const grant = teamId ? teamGrant(device, teamId) : undefined

  if (!grant) return null
  if (grant.managerIds.includes(actorId)) return 'manage'

  return grant.everyone || grant.userIds.includes(actorId) ? 'use' : null
}

/** A teammate's computer counts only while its owner is still in the team. */
async function grantedInTeam(
  devices: AgentDevice[],
  actorId: string,
  teamId: string,
  deps: DeviceAccessDeps,
): Promise<AgentDevice[]> {
  const kept = await Promise.all(
    devices.map(async (device) =>
      device.userId !== actorId &&
      deviceAccess(device, actorId, teamId) &&
      (await deps.role(device.userId, teamId))
        ? device
        : null,
    ),
  )

  return kept.filter((device) => device !== null)
}

/** The person's own computers, then in this team its cloud computers and teammates' they may use. */
export async function listAccessibleDevices(
  actorId: string,
  teamId: string | undefined,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<AgentDevice[]> {
  const own = (await deps.listDevices(actorId)).filter((device) => !device.box)

  if (!teamId || !(await deps.role(actorId, teamId))) return own
  const boxes = (await deps.listBoxes(teamId)).filter((device) =>
    deviceAccess(device, actorId, teamId),
  )

  return [
    ...own,
    ...boxes,
    ...(await grantedInTeam(await deps.listGranted(teamId), actorId, teamId, deps)),
  ]
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

  // A Box lives in a team: asking for your own without saying which is a client bug.
  if (!teamId && own?.box)
    throw new AppError(400, 'team_required', 'Pass the teamId of the Box’s team')
  const member = teamId ? (await deps.role(actorId, teamId)) !== null : false
  // Query the requested team, never a global deviceId lookup or the owner's other teams.
  const candidates =
    own && !own.box
      ? [own]
      : teamId && member
        ? [
            ...(await deps.listBoxes(teamId)).filter((box) => box.deviceId === deviceId),
            ...(await grantedInTeam(
              await deps.findGranted(teamId, deviceId),
              actorId,
              teamId,
              deps,
            )),
          ]
        : []
  const device = candidates.length === 1 ? candidates[0] : undefined

  if (!device || !allows(deviceAccess(device, actorId, teamId), level))
    throw new AppError(404, 'device_not_found', 'Device is not available')

  return device
}

/**
 * Closes what these people have open on these Boxes (terminal, CUA, chat streams)
 * and nothing else: the host's tunnel and other viewers stay. A reconnect is
 * refused by the access check. Best effort: a missed message leaves a stream only
 * until its next reconnect.
 */
export async function revokeBoxStreams(
  devices: AgentDevice[],
  actorIds: string[],
  /** Only streams opened in this team; the same person may use the computer in another. */
  teamId?: string,
): Promise<void> {
  const bus = tunnelBus()

  await Promise.all(
    devices.flatMap((device) =>
      actorIds.map((actorId) =>
        bus
          .publish(
            holderChannel(device.userId, device.deviceId),
            JSON.stringify({
              t: 'revoke-actor',
              actorId,
              ...(teamId ? { teamId } : {}),
            } satisfies HolderMessage),
          )
          .catch(() => {}),
      ),
    ),
  )
}

/** For a person who left the team, was removed, or lost a role: every Box of that team. */
export async function revokeTeamBoxStreams(teamId: string, actorId: string): Promise<void> {
  await revokeBoxStreams(await listTeamBoxes(teamId).catch(() => []), [actorId], teamId)
}
