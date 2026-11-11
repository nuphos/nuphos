import { runtimePresenceStore } from './local-runtime/presence'

/** Online means holding the live, pong-confirmed tunnel; local exec and local agents share it. */
export async function isDevicePresent(userId: string, deviceId: string): Promise<boolean> {
  return (await runtimePresenceStore().get(userId, deviceId)) != null
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
