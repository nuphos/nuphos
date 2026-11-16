// A computer's Nuphos Desktop, updated by its owner from another of their computers. The
// Desktop reports its version and the update its updater found; asking it to update
// restarts it into that update the way Restart to update does, which ends every agent
// on it, so only its owner may, and the Desktop refuses while an agent task runs. A Box
// updates its host instead (box-update.ts). Nothing is stored: the report is the state,
// which the device list shows its owner (ownComputer in session-desktops.ts).

import { updateLocalApp } from '@/lib/agent/devices/local-runtime/instances'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { getAgentDevice } from '@/lib/agent/devices/store'
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
