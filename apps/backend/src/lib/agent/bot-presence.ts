// Whether a Bot can reply now, from what Nuphos already knows of it: one answer
// that every surface shows the same way (#3308). Nothing here is stored.
import { listRuntimeInstances } from '@/lib/claude-code-preview/runtime-catalog'

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

export function botPresence(_signals: {
  ownerRemoved: boolean
  runtime: BotRuntime | null
  busy: boolean
}): BotPresence {
  return { state: 'online' }
}

export async function botRuntimes(
  _teamId: string,
  bots: { userId: string; runtimeId?: string }[],
  _list = listRuntimeInstances,
): Promise<(BotRuntime | null)[]> {
  return bots.map(() => null)
}
