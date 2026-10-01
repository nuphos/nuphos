import { runtimePresenceStore } from './local-runtime/presence'

/** Local exec uses the same live, pong-confirmed tunnel as local agents. */
export async function isDevicePresent(userId: string, deviceId: string): Promise<boolean> {
  const presence = await runtimePresenceStore().get(userId, deviceId)

  return presence?.status?.localExec === true
}
