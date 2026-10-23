import { AppError } from '@/lib/errors'

import { getTeamLocalAgentSharing } from './local-share-ceiling'
import {
  findShareApproval,
  listDevicesSharedInTeam,
  requestShareApproval,
} from './local-share-store'
import { LOCAL_SHARE_LEVELS } from './local-share-types'
import { getAgentDevice, isActiveTeamMember } from './store'

import type { LocalAgentRef } from './local-runtime/address'
import type { ShareApproval } from './local-share-store'
import type { LocalAgentShare, LocalShareLevel, SharedLocalRuntimeUse } from './local-share-types'
import type { AgentDevice } from './store'

/**
 * Sharing a person's own computer with teammates, so they can place their own
 * conversations on its Local Agent. A Box is the team's and has its own access
 * list; this is only for computers that belong to one member.
 *
 * - `approve`: the owner approves each teammate's conversation before its first turn runs.
 * - `full`: turns run without asking.
 *
 * Either way the agent runs as the owner's OS account, with every login on that
 * computer, so a team ceiling (`localAgentSharing`) caps what an owner may grant.
 * A shared computer only runs conversations: terminal, files, sign-in, adding
 * agents and local exec stay with its owner.
 */
const rank = (level: LocalShareLevel) => LOCAL_SHARE_LEVELS.indexOf(level)

/** The lower of the two: an owner never grants more than the team allows. */
export function capShareLevel(level: LocalShareLevel, ceiling: LocalShareLevel): LocalShareLevel {
  return rank(level) <= rank(ceiling) ? level : ceiling
}

export function exceedsCeiling(level: LocalShareLevel, ceiling: LocalShareLevel): boolean {
  return rank(level) > rank(ceiling)
}

/** The share this computer has in this team, if any. */
export function teamShare(device: AgentDevice, teamId: string): LocalAgentShare | undefined {
  return device.box ? undefined : device.shares?.find((share) => share.teamId === teamId)
}

/**
 * What a teammate may do with someone else's own computer in this team, under
 * the ceiling; null when nothing. Never anything for the owner (they own it) or a Box.
 */
export function sharedLevelFor(
  device: AgentDevice,
  actorId: string,
  teamId: string,
  ceiling: LocalShareLevel,
): Exclude<LocalShareLevel, 'off'> | null {
  const share = teamShare(device, teamId)

  if (!share || device.userId === actorId) return null
  if (!share.everyone && !share.userIds.includes(actorId)) return null
  const level = capShareLevel(share.level, ceiling)

  return level === 'off' ? null : level
}

/**
 * Turns no person in the app sent: a channel, where anyone in it would drive
 * the owner's computer, a trigger or resource event, or another agent's thread.
 * They never run on a shared computer, whatever its level.
 */
const UNATTENDED_SOURCES = [
  'slack',
  'discord',
  'lark',
  'agent.trigger',
  'agent.resource',
  'agent.thread',
]

export function isUnattendedSource(source: string | undefined): boolean {
  return (
    source !== undefined &&
    UNATTENDED_SOURCES.some((prefix) => source === prefix || source.startsWith(`${prefix}.`))
  )
}

export type LocalShareDeps = {
  ceiling: (teamId: string) => Promise<LocalShareLevel>
  isMember: (userId: string, teamId: string) => Promise<boolean>
  listShared: (teamId: string) => Promise<AgentDevice[]>
  getDevice: (ownerId: string, deviceId: string) => Promise<AgentDevice | null>
  findApproval: typeof findShareApproval
  requestApproval: typeof requestShareApproval
}
export const localShareDeps: LocalShareDeps = {
  ceiling: (teamId) => getTeamLocalAgentSharing(teamId),
  isMember: (userId, teamId) => isActiveTeamMember(userId, teamId),
  listShared: (teamId) => listDevicesSharedInTeam(teamId),
  getDevice: (ownerId, deviceId) => getAgentDevice(ownerId, deviceId),
  findApproval: findShareApproval,
  requestApproval: requestShareApproval,
}

/** Teammates' computers shared with this person in this team, whose owners are still in it. */
export async function listSharedDevices(
  actorId: string,
  teamId: string,
  deps: LocalShareDeps = localShareDeps,
): Promise<{ device: AgentDevice; level: Exclude<LocalShareLevel, 'off'> }[]> {
  const ceiling = await deps.ceiling(teamId)

  if (ceiling === 'off' || !(await deps.isMember(actorId, teamId))) return []
  const listed = await Promise.all(
    (await deps.listShared(teamId)).map(async (device) => {
      const level = sharedLevelFor(device, actorId, teamId, ceiling)

      return level && (await deps.isMember(device.userId, teamId)) ? { device, level } : null
    }),
  )

  return listed.filter((entry) => entry !== null)
}

/** The computer and its level, or 404 exactly as for a computer that does not exist. */
export async function requireSharedDevice(
  actorId: string,
  teamId: string,
  ownerId: string,
  deviceId: string,
  deps: LocalShareDeps = localShareDeps,
): Promise<{ device: AgentDevice; level: Exclude<LocalShareLevel, 'off'> }> {
  const device = await deps.getDevice(ownerId, deviceId)
  const ceiling = device ? await deps.ceiling(teamId) : 'off'
  const level = device ? sharedLevelFor(device, actorId, teamId, ceiling) : null

  if (
    !device ||
    !level ||
    !(await deps.isMember(actorId, teamId)) ||
    !(await deps.isMember(ownerId, teamId))
  )
    throw new AppError(404, 'device_not_found', 'Device is not available')

  return { device, level }
}

/**
 * Before a teammate's conversation runs its first turn on a computer shared at
 * `approve`, its owner says yes. Asking again while it waits changes nothing.
 */
export async function requireShareApproval(
  input: { device: AgentDevice; teamId: string; actorId: string; sessionId: string },
  deps: LocalShareDeps = localShareDeps,
): Promise<void> {
  const { device, teamId, actorId, sessionId } = input
  const found: ShareApproval | null = await deps.findApproval(
    device.userId,
    device.deviceId,
    sessionId,
    actorId,
  )

  if (found?.status === 'approved') return
  if (found?.status === 'denied')
    throw new AppError(
      403,
      'local_share_denied',
      `The owner of ${device.label} declined to run this agent on it. Move it to another runtime to continue.`,
    )
  if (!found) await deps.requestApproval({ device, teamId, actorId, sessionId })
  throw new AppError(
    403,
    'local_share_approval_required',
    `${device.label} is shared with you on the condition that its owner approves each agent. They have been asked; send again once they approve.`,
  )
}

/** One call on a local agent, as resolveLocalRuntimeEndpoint received it. */
export type SharedDeviceCall = {
  teamId: string
  ref: LocalAgentRef
  userId: string
  purpose: 'transport' | 'control' | 'login'
  use: SharedLocalRuntimeUse | undefined
}

/**
 * Someone else's own computer, shared with this person, for one of a conversation's
 * own calls; null when the call is not one (sign-in, terminal, files, Box updates).
 * Throws when it is shared but this conversation may not run there yet.
 */
export async function resolveSharedDevice(
  call: SharedDeviceCall,
  deps: LocalShareDeps | undefined,
): Promise<AgentDevice | null> {
  const { teamId, ref, userId, purpose, use } = call

  if (!use || !deps || ref.userId === userId || purpose === 'login') return null
  const shared = await requireSharedDevice(userId, teamId, ref.userId, ref.deviceId, deps)

  if (isUnattendedSource(use.source))
    throw new AppError(
      403,
      'local_share_unattended',
      'An agent from a channel or a trigger cannot run on a teammate’s computer. Move it to a team runtime.',
    )
  if (shared.level === 'approve' && purpose === 'transport' && use.sessionId)
    await requireShareApproval(
      { device: shared.device, teamId, actorId: userId, sessionId: use.sessionId },
      deps,
    )

  return shared.device
}

/** The person's own computers and Boxes, then teammates' computers shared with them. */
export async function withSharedDevices(
  own: AgentDevice[],
  actorId: string,
  teamId: string,
  deps: LocalShareDeps | undefined,
): Promise<{ device: AgentDevice; shared?: Exclude<LocalShareLevel, 'off'> }[]> {
  const shared = deps ? await listSharedDevices(actorId, teamId, deps) : []

  return [
    ...own.map((device) => ({ device })),
    ...shared.map(({ device, level }) => ({ device, shared: level })),
  ]
}

/** When the caller has no access of their own, a teammate's computer shared with them for this call. */
export async function orSharedDevice(
  own: Promise<AgentDevice>,
  call: SharedDeviceCall,
  deps: LocalShareDeps | undefined,
): Promise<AgentDevice> {
  return own.catch(async (error: unknown) => {
    if (!(error instanceof AppError && error.status === 404)) throw error
    const shared = await resolveSharedDevice(call, deps)

    if (!shared) throw error

    return shared
  })
}
