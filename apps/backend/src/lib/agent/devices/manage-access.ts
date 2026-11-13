import { AppError } from '@/lib/errors'

import { allows, deviceAccess, deviceAccessDeps, requireDeviceAccess } from './box-access'
import { agentDevices } from './store'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'

/**
 * A shell on a computer reads its files, its agents' sign-in among them, and acts as the
 * account signed in there. So running commands on it takes managing it; a terminal also opens
 * for those who use a Box whose owner lets them.
 */
export type ShellPurpose = 'exec' | 'terminal'

export function shellAllowed(
  device: AgentDevice,
  actorId: string,
  teamId: string | undefined,
  purpose: ShellPurpose,
): boolean {
  const access = deviceAccess(device, actorId, teamId)

  return (
    allows(access, 'manage') ||
    (purpose === 'terminal' && access === 'use' && device.box?.useTerminal === true)
  )
}

/** The computer, when the actor may open this shell on it; 403 for one who only uses it. */
export async function requireShellAccess(
  actorId: string,
  teamId: string | undefined,
  deviceId: string,
  purpose: ShellPurpose,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<AgentDevice> {
  const device = await requireDeviceAccess(actorId, teamId, deviceId, 'use', deps)

  if (!shellAllowed(device, actorId, teamId, purpose))
    throw new AppError(
      403,
      'device_manage_required',
      purpose === 'terminal'
        ? 'Only people who manage this computer can open a terminal on it.'
        : 'Only people who manage this computer can run commands on it.',
    )

  return device
}

/** The computer, when the actor may use it. */
export function requireDeviceUse(
  actorId: string,
  teamId: string | undefined,
  deviceId: string,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<AgentDevice> {
  return requireDeviceAccess(actorId, teamId, deviceId, 'use', deps)
}

/**
 * The computer, when the actor may sign its agents in or out. An agent acts as whoever signed it
 * in, for everyone who uses it, so that takes managing the computer; 403 for one who only uses it.
 */
export async function requireAgentSignInAccess(
  actorId: string,
  teamId: string | undefined,
  deviceId: string,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<AgentDevice> {
  const device = await requireDeviceAccess(actorId, teamId, deviceId, 'use', deps)

  if (!allows(deviceAccess(device, actorId, teamId), 'manage'))
    throw new AppError(
      403,
      'device_manage_required',
      'Only people who manage this computer can sign its agents in or out.',
    )

  return device
}

/** Whether those who only use this Box may open a terminal on it. */
export async function setBoxUseTerminal(
  userId: string,
  deviceId: string,
  useTerminal: boolean,
): Promise<boolean> {
  const result = await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true } },
    { $set: { 'box.useTerminal': useTerminal, updatedAt: new Date() } },
  )

  return result.matchedCount > 0
}
