// Whether a Bot can reply now, from what Nuphos already knows of it: one answer
// that every surface shows the same way (#3308). Nothing here is stored.
import { listRuntimeInstances } from '@/lib/claude-code-preview/runtime-catalog'
import { fetchRuntimeQuota } from '@/lib/claude-code-preview/runtime-quota'
import { usedUp } from '@/lib/claude-code-preview/runtime-quota-shape'

import type { RuntimeInstance } from '@/lib/claude-code-preview/runtime-instances'
import type { RuntimeQuota } from '@/lib/claude-code-preview/runtime-quota-shape'

export type BotOfflineReason =
  | 'owner_removed'
  | 'runtime_deleted'
  | 'runtime_disabled'
  | 'computer_offline'
  | 'sign_in_required'
  | 'usage_limit'

export type BotPresence =
  | { state: 'online' }
  | { state: 'busy' }
  | { state: 'offline'; reason: BotOfflineReason; resetsAt?: string }

/** A Bot's runtime as its owner's list has it: no instance when it is gone. */
export type BotRuntime = { instance?: RuntimeInstance; quota?: RuntimeQuota }

export function botPresence(signals: {
  /** The Bot's owner has left the team. */
  ownerRemoved: boolean
  /** Null while the Bot names no runtime of its own. */
  runtime: BotRuntime | null
  /** A turn of the Bot's is running. */
  busy: boolean
}): BotPresence {
  const offline = (reason: BotOfflineReason, resetsAt?: string): BotPresence => ({
    state: 'offline',
    reason,
    ...(resetsAt ? { resetsAt } : {}),
  })
  const { instance, quota } = signals.runtime ?? {}

  if (signals.ownerRemoved) return offline('owner_removed')
  if (signals.runtime && !instance) return offline('runtime_deleted')
  if (instance?.status === 'disabled' || instance?.deletion) return offline('runtime_disabled')
  if (instance?.local && !instance.local.online) return offline('computer_offline')
  if (instance?.local?.signedIn === false) return offline('sign_in_required')
  const spent = usedUp(quota)

  if (spent) return offline('usage_limit', spent.resetsAt)

  return { state: signals.busy ? 'busy' : 'online' }
}

/** Each Bot's runtime, its owner's list read once per owner. */
export async function botRuntimes(
  teamId: string,
  bots: { userId: string; runtimeId?: string }[],
  list = listRuntimeInstances,
): Promise<(BotRuntime | null)[]> {
  const byOwner = new Map<string, Promise<RuntimeInstance[]>>()
  const instancesOf = (userId: string) => {
    const read = byOwner.get(userId) ?? list(teamId, userId)

    byOwner.set(userId, read)

    return read
  }

  return Promise.all(
    bots.map(async ({ userId, runtimeId }) => {
      if (!runtimeId) return null
      const instance = (await instancesOf(userId)).find((entry) => entry.id === runtimeId)

      // Only what a computer reported: asking a cloud runtime would probe it on every poll.
      if (instance?.kind !== 'local') return { ...(instance ? { instance } : {}) }

      return { instance, quota: await fetchRuntimeQuota(teamId, instance) }
    }),
  )
}
