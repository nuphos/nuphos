import { destroyBox } from '@/lib/agent/devices/box-instabox'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { holderChannel } from '@/lib/agent/devices/local-runtime/protocol'
import {
  deleteAgentDevice,
  listTeamBoxes,
  revokeAgentDeviceCredential,
} from '@/lib/agent/devices/store'

/**
 * Deletes a Box: closes its tunnel cleanly before the machine goes, kills the machine,
 * then removes its row. False when the machine may still run at the provider.
 */
export async function deleteBox(userId: string, deviceId: string): Promise<boolean> {
  if (await revokeAgentDeviceCredential(userId, deviceId))
    await tunnelBus().publish(holderChannel(userId, deviceId), JSON.stringify({ t: 'revoke' }))
  const killed = await destroyBox(userId, deviceId)

  await deleteAgentDevice(userId, deviceId)

  return killed
}

/** A deleted team's Boxes go with it, so nothing keeps running that no one can reach. */
export async function deleteTeamBoxes(teamId: string): Promise<void> {
  for (const box of await listTeamBoxes(teamId)) await deleteBox(box.userId, box.deviceId)
}
