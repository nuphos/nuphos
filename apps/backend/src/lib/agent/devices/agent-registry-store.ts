import {
  goneAdditions,
  mergeAgentRegistry,
  renameRegisteredAgent,
  reportedAgents,
} from './agent-registry'
import { agentDevices } from './store'

import type { AgentAddition } from './agent-registry'
import type { LocalRuntimeStatus, RemovableAgent } from './local-runtime/protocol'
import type { RequestOrigin } from '@/lib/request-origin'

/**
 * Notes that the host reported in, and keeps the agents a status report shows signed in
 * listed after the computer goes offline. Who added an agent is forgotten once it is gone.
 */
export async function recordDeviceAgents(
  userId: string,
  deviceId: string,
  status: LocalRuntimeStatus,
  from?: RequestOrigin,
): Promise<void> {
  const device = await agentDevices().findOne(
    { userId, deviceId },
    { projection: { agents: 1, addedAgents: 1 } },
  )

  if (!device) return
  const next = mergeAgentRegistry(device.agents ?? [], reportedAgents(status))
  // Pulled by id, so an addition noted since the read above is never overwritten.
  const gone = goneAdditions(device.addedAgents ?? [], next ?? device.agents ?? [], status)

  await agentDevices().updateOne(
    { userId, deviceId },
    {
      $set: {
        lastSeenAt: new Date(),
        ...(from ? { lastSeen: from } : {}),
        ...(next ? { agents: next } : {}),
      },
      ...(gone.length > 0 ? { $pull: { addedAgents: { instanceId: { $in: gone } } } } : {}),
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

/** A backstop: entries leave with their agent (goneAdditions), and a host lists at most 100. */
const ADDITIONS_KEPT = 100

/** Notes who added an agent; a retry of the same instance keeps the first entry. */
export async function recordAgentAddition(
  userId: string,
  deviceId: string,
  addition: AgentAddition,
): Promise<void> {
  await agentDevices().updateOne(
    { userId, deviceId, 'addedAgents.instanceId': { $ne: addition.instanceId } },
    { $push: { addedAgents: { $each: [addition], $slice: -ADDITIONS_KEPT } } },
  )
}

/** Forgets an addition whose agent was never made. */
export async function forgetAgentAddition(
  userId: string,
  deviceId: string,
  instanceId: string,
): Promise<void> {
  await agentDevices().updateOne({ userId, deviceId }, { $pull: { addedAgents: { instanceId } } })
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
    {
      $pull: {
        agents: { instanceId: null, ...agent },
        ...('instanceId' in agent ? { addedAgents: { instanceId: agent.instanceId } } : {}),
      },
    },
  )
}
