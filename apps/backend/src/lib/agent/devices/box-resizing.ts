// A Box being resized: instabox resizes a machine only while it is stopped, so a resize
// stops it, resizes it and starts it again in the background. The start is stored on the
// Box until the resize ends, so every viewer sees it resizing rather than paused, and a
// resume, wake or heal leaves it alone meanwhile. A failure is stored until the next resize.

import { agentDevices } from './store'

import type { AgentDevice } from './store'

/** A resize still marked after this long was cut short (the backend restarted mid-way). */
export const BOX_RESIZE_WINDOW_MS = 10 * 60_000

/** When the Box's resize began, while it is still underway; undefined otherwise. */
export function boxResizingSince(device: AgentDevice, now = Date.now()): Date | undefined {
  const startedAt = device.box?.resize?.startedAt

  return startedAt && now - startedAt.getTime() <= BOX_RESIZE_WINDOW_MS ? startedAt : undefined
}

/**
 * Notes that a resize begins, unless another one still runs; false when one does. The check
 * and the write are one update, so two clicks cannot both start one.
 */
export async function markBoxResizeStarted(
  userId: string,
  deviceId: string,
  at = new Date(),
): Promise<boolean> {
  const result = await agentDevices().updateOne(
    {
      userId,
      deviceId,
      box: { $exists: true },
      $nor: [{ 'box.resize.startedAt': { $gt: new Date(at.getTime() - BOX_RESIZE_WINDOW_MS) } }],
    },
    { $set: { 'box.resize': { startedAt: at } } },
  )

  return result.matchedCount > 0
}

/** Ends the resize, keeping why it failed when it did. */
export async function endBoxResize(userId: string, deviceId: string, error?: string) {
  await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true } },
    error ? { $set: { 'box.resize': { error } } } : { $unset: { 'box.resize': '' } },
  )
}

/** A resize in a Box's view: stopped on purpose and back on its own, or why it failed. */
export function boxResizeView(device: AgentDevice, manages: boolean) {
  const resizing = boxResizingSince(device)

  if (resizing) return { resizeStartedAt: resizing.toISOString() }

  const error = device.box?.resize?.error

  return manages && error ? { resizeError: error } : {}
}
