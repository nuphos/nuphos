import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import { forgetAgentReset, recordAgentReset, retireAgentResets } from './agent-registry-store'
import { deviceOwner } from './box-access'
import { resetLocalAgentInstance } from './local-runtime/instances'
import { runtimePresenceStore } from './local-runtime/presence'
import { pendingActor } from './pending-removals'
import { agentDevices, isActiveTeamMember } from './store'

import type { PendingRemoval, PendingReset } from './agent-registry'
import type { LocalRuntimePresenceStore } from './local-runtime/presence'
import type { LocalRuntimeStatus, RemovableAgent } from './local-runtime/protocol'

/** A computer's pending resets, the removals that make one moot, and its current owner. */
type PendingOnDevice = { resets: PendingReset[]; removals: PendingRemoval[]; owner: string }

export type PendingResetDeps = {
  pending: (userId: string, deviceId: string) => Promise<PendingOnDevice | undefined>
  presence: LocalRuntimePresenceStore['get']
  reset: typeof resetLocalAgentInstance
  record: typeof recordAgentReset
  forget: typeof forgetAgentReset
  retire: typeof retireAgentResets
  isMember: typeof isActiveTeamMember
  /** Runs a retry later; a reset that failed is tried again without waiting for a report. */
  later: (retry: () => void, ms: number) => void
}

const defaultDeps: PendingResetDeps = {
  pending: async (userId, deviceId) => {
    const device = await agentDevices().findOne(
      { userId, deviceId },
      { projection: { userId: 1, box: 1, pendingResets: 1, removedAgents: 1 } },
    )

    return device
      ? {
          resets: device.pendingResets ?? [],
          removals: device.removedAgents ?? [],
          owner: deviceOwner(device),
        }
      : undefined
  },
  presence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
  reset: resetLocalAgentInstance,
  record: recordAgentReset,
  forget: forgetAgentReset,
  retire: retireAgentResets,
  isMember: isActiveTeamMember,
  later: (retry, ms) => {
    setTimeout(retry, ms).unref()
  },
}

/** `queued` runs once the computer reports in: `offline` when it is not reachable now,
 *  `unsupported` when its host is too old to reset agents until it updates. */
export type AgentResetResult =
  { state: 'done' } | { state: 'queued'; why: 'offline' | 'unsupported' }

const unreachable = (error: unknown) =>
  error instanceof AppError &&
  (error.code === 'runtime_offline' || error.code === 'agent_instance_timeout')

/** How a host answers for an added agent it no longer has. */
const vanished = (error: unknown) =>
  error instanceof AppError &&
  error.code === 'agent_instance_failed' &&
  error.message === 'Runtime instance not found'

const sameAgent = (a: RemovableAgent, b: RemovableAgent) =>
  'instanceId' in a
    ? 'instanceId' in b && a.instanceId === b.instanceId
    : 'provider' in b && a.provider === b.provider

/**
 * Signs an agent out on its computer: at once when the computer can, else when it next
 * reports in able to. The caller has checked `by` may; `device.userId` is the computer's
 * transport user. A host that answers with a refusal throws, and nothing is queued.
 */
export async function requestAgentReset(
  device: { userId: string; deviceId: string },
  agent: RemovableAgent,
  by: { actorId: string; teamId: string },
  deps: PendingResetDeps = defaultDeps,
): Promise<AgentResetResult> {
  const { userId, deviceId } = device
  const status = (await deps.presence(userId, deviceId))?.status
  let why: 'offline' | 'unsupported' = status ? 'unsupported' : 'offline'

  if (status?.agentReset === true)
    try {
      const asked = new Date()

      await deps.reset({ userId, deviceId, ...by }, agent)
      // One queued before would otherwise run again later, after a new sign-in.
      await deps.retire(userId, deviceId, agent, asked)

      return { state: 'done' }
    } catch (error) {
      if (!unreachable(error)) throw error
      why = 'offline'
    }
  await deps.record(userId, deviceId, { id: randomUUID(), agent, ...by, at: new Date() })
  // It may have reconnected meanwhile, after its report already came and went.
  const now = (await deps.presence(userId, deviceId))?.status

  if (now) void settlePendingResets(userId, deviceId, now, deps)

  return { state: 'queued', why }
}

const RETRY_MS = 60_000
const RETRIES = 5
/** Devices whose pending resets are being settled here, so two reports never race one. */
const settling = new Set<string>()
/** Devices asked to settle again while a pass was running: a reset saved meanwhile. */
const again = new Set<string>()

/**
 * Has a computer that just reported in run the resets it could not run when they were asked
 * for. One it cannot run stays pending, retried a few times while the computer stays
 * connected and again on its next report. Never throws.
 */
export async function settlePendingResets(
  userId: string,
  deviceId: string,
  status: LocalRuntimeStatus,
  deps: PendingResetDeps = defaultDeps,
  attempt = 0,
): Promise<void> {
  const key = `${userId}:${deviceId}`

  if (status.agentReset !== true) return
  if (settling.has(key)) {
    again.add(key)

    return
  }
  settling.add(key)
  let failed = false

  try {
    const { resets, removals, owner } = (await deps.pending(userId, deviceId)) ?? {
      resets: [],
      removals: [],
      owner: userId,
    }

    for (const reset of resets) {
      try {
        // Removing the agent deletes its credentials anyway.
        if (removals.some((removal) => sameAgent(removal.agent, reset.agent))) {
          await deps.forget(userId, deviceId, reset.id)
          continue
        }
        const actorId = await pendingActor(reset, owner, deps)

        // A sign-in since retires it (#2434): read when the pass began, it would sign that out.
        if (!(await deps.pending(userId, deviceId))?.resets.some(({ id }) => id === reset.id))
          continue
        if (!actorId) {
          await deps.forget(userId, deviceId, reset.id)
          logFailure(deviceId, 'no one in the team may reset it any longer', reset.id)
          continue
        }
        await deps
          .reset({ userId, actorId, deviceId, teamId: reset.teamId }, reset.agent)
          // An agent the computer no longer has has nothing left to sign out.
          .catch((error: unknown) => {
            if (!vanished(error)) throw error
          })
        await deps.forget(userId, deviceId, reset.id)
      } catch (error) {
        failed = true
        logFailure(deviceId, error, reset.id)
      }
    }
  } catch (error) {
    failed = true
    logFailure(deviceId, error)
  } finally {
    settling.delete(key)
  }
  // A report during a failed pass (stopping an agent sends one) waits for the retry with the rest,
  // or a reset that keeps failing would run again at once on every report it causes.
  if (again.delete(key) && !failed) return settlePendingResets(userId, deviceId, status, deps)
  if (failed && attempt < RETRIES)
    deps.later(
      () => void settlePendingResets(userId, deviceId, status, deps, attempt + 1),
      RETRY_MS,
    )
}

function logFailure(deviceId: string, error: unknown, resetId?: string): void {
  logEvent('warn', 'agent.device.pending_reset_failed', {
    device_id: deviceId,
    ...(resetId ? { reset_id: resetId } : {}),
    error_message: error instanceof Error ? error.message : String(error),
  })
}
