import { logEvent } from '@/lib/observability'

import { forgetAgentRemoval, removeDeviceAgent } from './agent-registry-store'
import { removeLocalAgentInstance } from './local-runtime/instances'
import { runtimePresenceStore } from './local-runtime/presence'
import { agentDevices, isActiveTeamMember } from './store'

import type { PendingRemoval } from './agent-registry'
import type { LocalRuntimeStatus } from './local-runtime/protocol'

export type PendingRemovalDeps = {
  pending: (userId: string, deviceId: string) => Promise<PendingRemoval[] | undefined>
  remove: typeof removeLocalAgentInstance
  forgetAgent: typeof removeDeviceAgent
  forget: typeof forgetAgentRemoval
  isMember: typeof isActiveTeamMember
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
  isMember: isActiveTeamMember,
  later: (retry, ms) => {
    setTimeout(retry, ms).unref()
  },
}

const RETRY_MS = 60_000
const RETRIES = 5
/** Devices whose pending removals are being settled here, so two reports never race one. */
const settling = new Set<string>()
/** Devices asked to settle again while a pass was running: a removal saved meanwhile. */
const again = new Set<string>()

/**
 * Who the computer deletes the agent for: the remover while they are still in the team,
 * else the computer's owner. Undefined when no one in that team can any longer.
 */
async function removalActor(
  removal: PendingRemoval,
  owner: string,
  deps: PendingRemovalDeps,
): Promise<string | undefined> {
  if (await deps.isMember(removal.actorId, removal.teamId)) return removal.actorId
  if (await deps.isMember(owner, removal.teamId)) return owner

  return undefined
}

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

  if (status.agentInstances !== true) return
  if (settling.has(key)) {
    again.add(key)

    return
  }
  settling.add(key)
  let failed = false

  try {
    for (const removal of (await deps.pending(userId, deviceId)) ?? []) {
      try {
        const actorId = await removalActor(removal, userId, deps)

        if (!actorId) {
          // No one left may delete it, so it stops hiding the agent instead of hiding it forever.
          await deps.forget(userId, deviceId, removal.id)
          logFailure(deviceId, 'no one in the team may remove it any longer', removal.id)
          continue
        }
        await deps.remove({ userId, actorId, deviceId, teamId: removal.teamId }, removal.agent)
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
  if (again.delete(key)) return settlePendingRemovals(userId, deviceId, status, deps, attempt)
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

/** Settles at once when the computer is connected right now: one that reconnected while its
 *  removal was being saved has already reported in, and would not report again. */
export async function settleIfConnected(userId: string, deviceId: string): Promise<void> {
  const status = (await runtimePresenceStore().get(userId, deviceId))?.status

  if (status) await settlePendingRemovals(userId, deviceId, status)
}
