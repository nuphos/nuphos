import { runtimePresenceStore } from './local-runtime/presence'

/** Local exec uses the same live, pong-confirmed tunnel as local agents. */
export async function isDevicePresent(userId: string, deviceId: string): Promise<boolean> {
  const presence = await runtimePresenceStore().get(userId, deviceId)

  return presence?.status?.localExec === true
}

/** Polls the device's presence until it is here or the time is up. */
export async function waitForPresence(
  userId: string,
  deviceId: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await isDevicePresent(userId, deviceId)) return true
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  return false
}
