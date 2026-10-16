import { agentDevices } from './store'

import type { RemovableAgent } from './local-runtime/protocol'

/**
 * Drops one agent from a computer's registry, the only way a signed-in agent leaves it.
 * A default agent is its provider's entry without an instance id (null also matches absent).
 */
export async function removeDeviceAgent(
  userId: string,
  deviceId: string,
  agent: RemovableAgent,
): Promise<void> {
  await agentDevices().updateOne(
    { userId, deviceId },
    { $pull: { agents: { instanceId: null, ...agent } } },
  )
}
