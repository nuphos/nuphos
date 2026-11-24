import { destroyBox } from '@/lib/agent/devices/box-instabox'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { holderChannel } from '@/lib/agent/devices/local-runtime/protocol'
import { revokeOpenRouterKey } from '@/lib/agent/devices/box-openrouter'
import {
  deleteAgentDevice,
  getAgentDevice,
  revokeAgentDeviceCredential,
} from '@/lib/agent/devices/store'
import { logError } from '@/lib/observability'

import type { AgentDevice } from '@/lib/agent/devices/store'

/**
 * Deletes a Box: kills the machine, closes its tunnel, removes its row, then revokes the
 * OpenRouter key Nuphos gave it. A machine
 * still pausing throws before anything is revoked, so the Box stays usable. False when
 * the machine may still run at the provider.
 */
export async function deleteBox(userId: string, deviceId: string): Promise<boolean> {
  const keyHash = (await getAgentDevice(userId, deviceId))?.box?.openRouterKeyHash
  const killed = await destroyBox(userId, deviceId)

  if (await revokeAgentDeviceCredential(userId, deviceId))
    await tunnelBus().publish(holderChannel(userId, deviceId), JSON.stringify({ t: 'revoke' }))
  await deleteAgentDevice(userId, deviceId)
  if (keyHash) await revokeOpenRouterKey(keyHash)

  return killed
}

/**
 * A deleted team's Boxes go with it, so nothing keeps running that no one can reach. One
 * Box that fails is logged and does not stop the rest; a kill the provider refused is
 * already logged by destroyBox as agent.box.kill_failed with the team id.
 */
export async function deleteTeamBoxes(teamId: string, boxes: AgentDevice[]): Promise<void> {
  for (const box of boxes) {
    await deleteBox(box.userId, box.deviceId).catch((error: unknown) => {
      logError('agent.box.team_delete_failed', error, {
        team_id: teamId,
        user_id: box.userId,
        device_id: box.deviceId,
      })
    })
  }
}
