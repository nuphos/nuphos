import { logEvent } from '@/lib/observability'

import { forgetAgentRemoval, removeDeviceAgent } from './agent-registry-store'
import { removeLocalAgentInstance } from './local-runtime/instances'
import { agentDevices } from './store'

import type { PendingRemoval } from './agent-registry'
import type { LocalRuntimeStatus } from './local-runtime/protocol'

export type PendingRemovalDeps = {
  pending: (userId: string, deviceId: string) => Promise<PendingRemoval[] | undefined>
  remove: typeof removeLocalAgentInstance
  forgetAgent: typeof removeDeviceAgent
  forget: typeof forgetAgentRemoval
  /** Runs a retry later; a removal that failed is tried again without waiting for a report. */
  later: (retry: () => void, ms: number) => void
}

const defaultDeps: PendingRemovalDeps = {
  pending: async (userId, deviceId) =>
    (await agentDevices().findOne({ userId, deviceId }, { projection: { removedAgents: 1 } }))
      ?.removedAgents,
  remove: removeLocalAgentInstance,
  forgetAgent: removeDeviceAgent,
  forget: forgetAgentRemoval,
  later: (retry, ms) => {
    setTimeout(retry, ms).unref()
  },
}

const RETRY_MS = 60_000
const RETRIES = 5
/** Devices whose pending removals are being settled here, so two reports never race one. */
const settling = new Set<string>()

/**
 * Has a computer that just reported in delete the agents removed while it was offline. A
 * removal it cannot carry out stays pending (and hidden), retried a few times while the
 * computer stays connected and again on its next report. Never throws.
 */
export async function settlePendingRemovals(
  userId: string,
  deviceId: string,
  status: LocalRuntimeStatus,
  deps: PendingRemovalDeps = defaultDeps,
  attempt = 0,
): Promise<void> {
  const key = `${userId}:${deviceId}`

  if (status.agentInstances !== true || settling.has(key)) return
  settling.add(key)
  let failed = false

  try {
    for (const removal of (await deps.pending(userId, deviceId)) ?? []) {
      try {
        await deps.remove(
          { userId, actorId: removal.actorId, deviceId, teamId: removal.teamId },
          removal.agent,
        )
        // Drops an entry a report registered before the removal was marked.
        await deps.forgetAgent(userId, deviceId, removal.agent)
        await deps.forget(userId, deviceId, removal.id)
      } catch (error) {
        failed = true
        logFailure(deviceId, error, removal.id)
      }
    }
  } catch (error) {
    failed = true
    logFailure(deviceId, error)
  } finally {
    settling.delete(key)
  }
  if (failed && attempt < RETRIES)
    deps.later(
      () => void settlePendingRemovals(userId, deviceId, status, deps, attempt + 1),
      RETRY_MS,
    )
}

function logFailure(deviceId: string, error: unknown, removalId?: string): void {
  logEvent('warn', 'agent.device.pending_removal_failed', {
    device_id: deviceId,
    ...(removalId ? { removal_id: removalId } : {}),
    error_message: error instanceof Error ? error.message : String(error),
  })
}
