import { healBox } from './box-instabox'
import { parseLocalRuntimeId } from './local-runtime/address'
import { isDevicePresent } from './presence'
import { getAgentDevice } from './store'

/**
 * True when this runtime is a Box whose host is not connected; its machine is then
 * resumed in the background (healBox, at most once a minute). Nothing waits on it:
 * a send queues, and the session queue starts the turn once the Box is back.
 */
export async function wakeOfflineBox(runtimeId: string | undefined): Promise<boolean> {
  const ref = runtimeId ? parseLocalRuntimeId(runtimeId) : undefined

  if (!ref || (await isDevicePresent(ref.userId, ref.deviceId))) return false
  if (!(await getAgentDevice(ref.userId, ref.deviceId))?.box?.sandboxId) return false
  healBox(ref.userId, ref.deviceId)

  return true
}
