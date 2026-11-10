import { logEvent } from '@/lib/observability'

import { forgetAgentRemoval } from './agent-registry-store'
import { removeLocalAgentInstance } from './local-runtime/instances'
import { agentDevices } from './store'

import type { PendingRemoval } from './agent-registry'
import type { LocalRuntimeStatus } from './local-runtime/protocol'

export type PendingRemovalDeps = {
  pending: (userId: string, deviceId: string) => Promise<PendingRemoval[] | undefined>
  remove: typeof removeLocalAgentInstance
  forget: typeof forgetAgentRemoval
}

const defaultDeps: PendingRemovalDeps = {
  pending: async (userId, deviceId) =>
    (await agentDevices().findOne({ userId, deviceId }, { projection: { removedAgents: 1 } }))
      ?.removedAgents,
  remove: removeLocalAgentInstance,
  forget: forgetAgentRemoval,
}

/**
 * Has a computer that just reported in delete the agents removed while it was offline. A
 * removal it cannot carry out stays pending (and hidden) for its next report.
 */
export async function settlePendingRemovals(
  userId: string,
  deviceId: string,
  status: LocalRuntimeStatus,
  deps: PendingRemovalDeps = defaultDeps,
): Promise<void> {
  if (status.agentInstances !== true) return
  for (const removal of (await deps.pending(userId, deviceId)) ?? []) {
    try {
      await deps.remove(
        { userId, actorId: removal.actorId, deviceId, teamId: removal.teamId },
        removal.agent,
      )
      await deps.forget(userId, deviceId, removal.id)
    } catch (error) {
      logEvent('warn', 'agent.device.pending_removal_failed', {
        device_id: deviceId,
        removal_id: removal.id,
        error_message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
