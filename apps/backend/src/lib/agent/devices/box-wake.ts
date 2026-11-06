import { healBox } from './box-instabox'
import { assertCanResume } from './box-instabox-limit'
import { parseLocalRuntimeId } from './local-runtime/address'
import { isDevicePresent } from './presence'
import { getAgentDevice } from './store'

/**
 * True when this runtime is a Box whose host is not connected; its machine is then
 * resumed in the background (healBox, at most once a minute). Nothing waits on it:
 * a send queues, and the session queue starts the turn once the Box is back.
 * A Box the team's vCPU limit cannot resume would never come back, so that is
 * refused now with the limit's 402 instead of queueing behind it.
 */
export async function wakeOfflineBox(runtimeId: string | undefined): Promise<boolean> {
  const ref = runtimeId ? parseLocalRuntimeId(runtimeId) : undefined

  if (!ref || (await isDevicePresent(ref.userId, ref.deviceId))) return false
  const box = (await getAgentDevice(ref.userId, ref.deviceId))?.box

  if (!box?.sandboxId) return false
  // Only the deployment's account has a vCPU limit; a team's own account bills it.
  if (!box.accountId) await assertCanResume(box.teamId, box.sandboxId)
  healBox(ref.userId, ref.deviceId)

  return true
}
