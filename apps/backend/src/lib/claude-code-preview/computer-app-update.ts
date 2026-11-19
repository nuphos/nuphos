// A computer's Nuphos Desktop, updated by its owner from another of their computers. The
// Desktop reports its version and the update its updater found; asking it to update
// restarts it into that update the way Restart to update does, which ends every agent
// on it, so only its owner may, and the Desktop refuses while an agent task runs. A Box
// updates its host instead (box-update.ts). Nothing is stored: the report is the state,
// which the device list shows its owner (ownComputer in session-desktops.ts).

import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { setLocalAutoInstall, updateLocalApp } from '@/lib/agent/devices/local-runtime/instances'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { agentDevices, getAgentDevice } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

export type ComputerAppUpdateDeps = {
  isDesktop: (userId: string, deviceId: string) => Promise<boolean>
  status: (userId: string, deviceId: string) => Promise<LocalRuntimeStatus | undefined>
  update: typeof updateLocalApp
}

const defaultDeps: ComputerAppUpdateDeps = {
  isDesktop: async (userId, deviceId) => {
    const device = await getAgentDevice(userId, deviceId)

    return Boolean(device && !device.box)
  },
  status: async (userId, deviceId) => (await runtimePresenceStore().get(userId, deviceId))?.status,
  update: updateLocalApp,
}

/** Asks one of the caller's own computers to restart into its staged update. */
export async function requestComputerAppUpdate(
  teamId: string,
  userId: string,
  deviceId: string,
  deps = defaultDeps,
): Promise<{ version: string }> {
  // Looked up as the caller's own: anyone else's computer, or a Box, is not found.
  if (!(await deps.isDesktop(userId, deviceId)))
    throw new AppError(404, 'device_not_found', 'Device is not available')
  const status = await deps.status(userId, deviceId)

  if (!status)
    throw new AppError(409, 'runtime_offline', 'The computer is offline. Open Nuphos on it first.')
  const update = status.app?.update

  if (!update?.ready)
    throw new AppError(409, 'app_update_not_ready', 'No update is downloaded on that computer yet.')
  await deps.update({ userId, actorId: userId, deviceId, teamId })

  return { version: update.version }
}

export type ComputerAutoInstallDeps = {
  /** The computer, when the actor may manage it in this team; throws otherwise. */
  manage: (actorId: string, teamId: string, deviceId: string) => Promise<{ userId: string }>
  online: (userId: string, deviceId: string) => Promise<boolean>
  set: typeof setLocalAutoInstall
  /** Notes the switch as the computer now has it, for its card while it is offline. */
  remember: (userId: string, deviceId: string, enabled: boolean) => Promise<unknown>
}

const autoInstallDeps: ComputerAutoInstallDeps = {
  manage: (actorId, teamId, deviceId) => requireDeviceAccess(actorId, teamId, deviceId, 'manage'),
  online: async (userId, deviceId) =>
    Boolean((await runtimePresenceStore().get(userId, deviceId))?.status),
  set: setLocalAutoInstall,
  remember: (userId, deviceId, autoInstall) =>
    agentDevices().updateOne({ userId, deviceId }, { $set: { autoInstall } }),
}

/**
 * Whoever manages a computer turns its automatic updates on or off. The switch lives on the
 * computer, which updates itself when idle (cli-auto-update.ts, auto-update.ts on the Desktop).
 */
export async function setComputerAutoInstall(
  teamId: string,
  actorId: string,
  deviceId: string,
  enabled: boolean,
  deps = autoInstallDeps,
): Promise<{ enabled: boolean }> {
  const { userId } = await deps.manage(actorId, teamId, deviceId)

  if (!(await deps.online(userId, deviceId)))
    throw new AppError(
      409,
      'runtime_offline',
      'The computer is offline. Turn it on, then change this.',
    )

  const answer = await deps.set({ userId, actorId, deviceId, teamId }, enabled)

  await deps.remember(userId, deviceId, answer.enabled)

  return answer
}
