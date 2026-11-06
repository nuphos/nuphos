// A Box: a cloud machine Nuphos orders on instabox for a person, which joins as
// that person's device with a one-time token and then behaves like any other
// computer of theirs. The machine is on the deployment's instabox account or on one
// the team bound; it is created with `vault: false`, so none of the account's
// secrets reach it.
//
// The row stores only which machine it is. Its state comes from instabox and
// from the device's presence, so a machine that instabox paused on its own is
// seen, and woken, like one Nuphos paused.

import { Sandbox } from '@insforge/instabox-sdk'

import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { boxConnection } from './box-instabox-account'
import {
  AGENT_COMMAND,
  QUICK_TIMEOUT_MS,
  downloadEnv,
  killBoxMachine,
  requireBackendUrl,
  unavailable,
} from './box-instabox-client'
import { startBox } from './box-instabox-start'
import { boxUpdatingSince, clearBoxUpdateStarted } from './box-updating'
import { noteBoxUsage } from './box-usage-history'
import { deleteDeviceJoinTokens } from './join-tokens'
import { isDevicePresent, waitForPresence } from './presence'
import { getAgentDevice } from './store'

import type { AgentDevice, AgentDeviceBox } from './store'

export { boxBackendUrl, boxesAvailable } from './box-instabox-client'
export { createBox } from './box-instabox-create'
export { boxState } from './box-instabox-state'
export type { BoxState } from './box-instabox-state'

/** How long a resume may take before the tunnel is back. */
const WAKE_TIMEOUT_MS = 60_000

type BoxDevice = AgentDevice & { box: AgentDeviceBox }

function requireBox(device: AgentDevice | null, deviceId: string): BoxDevice {
  if (!device?.box) throw new AppError(404, 'not_found', `No Box ${deviceId}`)

  return device as BoxDevice
}

function requireMachine(device: BoxDevice): string {
  if (!device.box.sandboxId) throw new AppError(409, 'box_state', 'The Box is still being created')

  return device.box.sandboxId
}

/**
 * A link to watch and use the Box's desktop (VNC in the browser). The link is a
 * bearer credential for the whole Box, so it is short-lived and never logged.
 */
export async function boxDesktopUrl(userId: string, deviceId: string): Promise<string> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)
  const sandboxId = requireMachine(device)

  try {
    const sandbox = await startBox(device.box, { sandboxId }, async () =>
      Sandbox.connect(sandboxId, {
        ...(await boxConnection(device.box, QUICK_TIMEOUT_MS)),
        resume: true,
      }),
    )

    await sandbox.desktop.start()
    const { url } = await sandbox.desktop.streamUrl({ viewOnly: false, ttlSeconds: 15 * 60 })

    return url
  } catch (error) {
    throw unavailable("Could not open the Box's desktop", error)
  }
}

const lastHeal = new Map<string, number>()

/** A running machine whose host is not connected gets its host started again, at most once a minute. */
export function healBox(userId: string, deviceId: string): void {
  const now = Date.now()

  if (now - (lastHeal.get(deviceId) ?? 0) < 60_000) return
  lastHeal.set(deviceId, now)
  void resumeBox(userId, deviceId).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'box_updating') return // starts on its own
    logError('agent.box.heal_failed', error, { user_id: userId, device_id: deviceId })
  })
}

export async function pauseBox(userId: string, deviceId: string): Promise<AgentDevice> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)
  const sandboxId = requireMachine(device)

  try {
    const sandbox = await Sandbox.connect(sandboxId, {
      ...(await boxConnection(device.box, QUICK_TIMEOUT_MS)),
      resume: false,
    })

    await sandbox.pause()
  } catch (error) {
    throw unavailable('Could not pause the Box', error)
  }
  await clearBoxUpdateStarted(userId, deviceId)

  return device
}

/**
 * Resumes the machine and makes sure the host runs: a machine resumed from a stop has lost
 * its processes. An update runs BOX_UPDATE_COMMAND, which restarts the host on the newest CLI.
 */
export async function resumeBox(userId: string, deviceId: string, command = AGENT_COMMAND) {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)
  const sandboxId = requireMachine(device)

  // Starting the host mid-update would run the old CLI while the new one installs.
  if (command === AGENT_COMMAND && boxUpdatingSince(device))
    throw new AppError(409, 'box_updating', 'The Box is updating and starts again on its own.')
  const url = requireBackendUrl()

  try {
    // Resume, wake and heal all start a machine, so they count against the team's limit.
    const sandbox = await startBox(device.box, { sandboxId }, async () =>
      Sandbox.connect(sandboxId, {
        ...(await boxConnection(device.box, QUICK_TIMEOUT_MS)),
        resume: true,
      }),
    )

    await sandbox.commands.run(command, {
      envs: { ...downloadEnv(), NUPHOS_API_URL: url },
      background: true,
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    throw unavailable('Could not resume the Box', error)
  }

  return device
}

/**
 * Deletes the machine and its disks; the caller removes the device row. A row that
 * never got its machine id (the backend went away mid-create) may still own a
 * machine: it is found by the device id in its metadata. A machine that is already
 * gone just goes; a kill that fails keeps the row, so nothing is orphaned silently.
 */
export async function destroyBox(userId: string, deviceId: string): Promise<void> {
  const device = requireBox(await getAgentDevice(userId, deviceId), deviceId)

  await deleteDeviceJoinTokens(deviceId)
  try {
    const conn = await boxConnection(device.box, QUICK_TIMEOUT_MS)

    await killBoxMachine(conn, device.box.sandboxId, deviceId)
  } catch (error) {
    logError('agent.box.kill_failed', error, { user_id: userId, device_id: deviceId })
    throw unavailable('Could not delete the Box', error)
  }
  // Its tunnel closed before the kill, while the machine still ran.
  noteBoxUsage(device.box.teamId)
}

/**
 * An offline Box that a turn or a command needs is resumed first, and this waits
 * for its tunnel. True once the Box is present; false when it did not come back in
 * time. A Box still being created is not woken.
 */
export async function wakeBox(userId: string, deviceId: string): Promise<boolean> {
  if (await isDevicePresent(userId, deviceId)) return true
  const device = await getAgentDevice(userId, deviceId)

  if (!device?.box?.sandboxId) return false
  if (!boxUpdatingSince(device)) await resumeBox(userId, deviceId)

  return waitForPresence(userId, deviceId, WAKE_TIMEOUT_MS)
}
