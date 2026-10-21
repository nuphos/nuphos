// A Box restarting its host for an update. Update stops the host, installs the newest CLI
// and starts the host again (BOX_UPDATE_COMMAND), so the machine runs while its host is
// away. The start is stored on the Box; the update is underway until the host reports in
// again (lastSeenAt is set on each connection's first report), the window passes or the
// Box is paused. Meanwhile its host is not started by a resume, and a wake only waits for it.

import { logError } from '@/lib/observability'

import { agentDevices } from './store'

import type { AgentDevice } from './store'

/** An update whose host has not come back after this long will not on its own. */
export const BOX_UPDATE_WINDOW_MS = 5 * 60_000

/** When the Box's update restart began, while it is still underway; undefined otherwise. */
export function boxUpdatingSince(device: AgentDevice, now = Date.now()): Date | undefined {
  const startedAt = device.box?.updateStartedAt

  if (!startedAt || now - startedAt.getTime() > BOX_UPDATE_WINDOW_MS) return undefined

  return device.lastSeenAt && device.lastSeenAt >= startedAt ? undefined : startedAt
}

/** Notes that an update has just restarted the Box's host. */
export async function markBoxUpdateStarted(
  userId: string,
  deviceId: string,
  at = new Date(),
): Promise<void> {
  await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true } },
    { $set: { 'box.updateStartedAt': at } },
  )
}

/**
 * A paused Box's update is over: resuming it starts its host again. The pause has already
 * happened, so a failed write is logged rather than reported; the note lapses on its own.
 */
export async function clearBoxUpdateStarted(userId: string, deviceId: string): Promise<void> {
  await agentDevices()
    .updateOne(
      { userId, deviceId, box: { $exists: true } },
      { $unset: { 'box.updateStartedAt': '' } },
    )
    .catch((error: unknown) => {
      logError('agent.box.update_clear_failed', error, { user_id: userId, device_id: deviceId })
    })
}
