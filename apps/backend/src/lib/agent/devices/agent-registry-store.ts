import { mergeAgentRegistry, renameRegisteredAgent, reportedAgents } from './agent-registry'
import { agentDevices } from './store'

import type { LocalRuntimeStatus, RemovableAgent } from './local-runtime/protocol'
import type { RequestOrigin } from '@/lib/request-origin'

/**
 * Notes that the host reported in, and keeps the agents a status report shows signed in
 * listed after the computer goes offline.
 */
export async function recordDeviceAgents(
  userId: string,
  deviceId: string,
  status: LocalRuntimeStatus,
  from?: RequestOrigin,
): Promise<void> {
  const device = await agentDevices().findOne({ userId, deviceId }, { projection: { agents: 1 } })

  if (!device) return
  const next = mergeAgentRegistry(device.agents ?? [], reportedAgents(status))

  await agentDevices().updateOne(
    { userId, deviceId },
    {
      $set: {
        lastSeenAt: new Date(),
        ...(from ? { lastSeen: from } : {}),
        ...(next ? { agents: next } : {}),
      },
    },
  )
}

export async function renameDeviceAgent(
  userId: string,
  deviceId: string,
  key: string,
  label: string,
): Promise<boolean> {
  const device = await agentDevices().findOne({ userId, deviceId }, { projection: { agents: 1 } })
  const next = renameRegisteredAgent(device?.agents ?? [], key, label)

  if (next) await agentDevices().updateOne({ userId, deviceId }, { $set: { agents: next } })

  return next !== null
}

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
